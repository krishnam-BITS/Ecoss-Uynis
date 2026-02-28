import type { FastifyInstance } from 'fastify';
import { prisma } from '@uynis/db';
import { z } from 'zod';
import { deleteObject, getObject } from '../lib/object-store.js';
import { createMentionNotifications } from '../lib/notifications.js';

type ReceiptState = 'SENT' | 'DELIVERED' | 'SEEN' | 'PLAYED';

type SenderShape = {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
};

type AttachmentShape = {
  id: string;
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO';
  url: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  expiresAt: Date | null;
};

type ReceiptShape = {
  userId: string;
  state: ReceiptState;
};

const userSearchQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
});

const conversationListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(['all', 'direct', 'group']).default('all'),
});

const directConversationSchema = z.object({
  userId: z.string().min(1),
});

const groupConversationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).optional(),
  memberIds: z.array(z.string().min(1)).max(40).default([]),
});

const conversationParamSchema = z.object({
  conversationId: z.string().min(1),
});

const messageParamSchema = z.object({
  messageId: z.string().min(1),
});
const attachmentParamSchema = z.object({
  attachmentId: z.string().min(1),
});

const messagesQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const mediaQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(36).default(12),
});

const attachmentSchema = z.object({
  kind: z.enum(['IMAGE', 'VIDEO', 'FILE', 'AUDIO']),
  url: z.string().url().max(2000),
  fileName: z.string().trim().max(240).optional(),
  mimeType: z.string().trim().max(120).optional(),
  sizeBytes: z.number().int().nonnegative().max(5_000_000_000).optional(),
  expiresAt: z.string().datetime().optional(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().max(4000).optional(),
  attachments: z.array(attachmentSchema).max(8).optional(),
  mentions: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  task: z
    .object({
      title: z.string().trim().min(2).max(200),
      assigneeUserId: z.string().min(1).optional(),
      dueAt: z.string().datetime().optional(),
      status: z.enum(['OPEN', 'DONE']).default('OPEN'),
    })
    .optional(),
});

const readConversationSchema = z.object({
  messageId: z.string().min(1).optional(),
});

const updateConversationSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(600).optional(),
});

const addMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['MEMBER', 'ADMIN']).default('MEMBER'),
});

const removeMemberParamSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1),
});

const callSchema = z.object({
  mode: z.enum(['AUDIO', 'VIDEO']),
});

const callIdParamSchema = z.object({
  callId: z.string().min(1),
});

const callSignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice', 'hold', 'resume']),
  targetUserId: z.string().min(1).optional(),
  sdp: z.string().max(200_000).optional(),
  hold: z.boolean().optional(),
  candidate: z
    .object({
      candidate: z.string().max(10_000),
      sdpMid: z.string().max(100).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(32).nullable().optional(),
      usernameFragment: z.string().max(100).nullable().optional(),
    })
    .optional(),
});

const callEventsQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
});

const callActionSchema = z.object({
  reason: z.string().trim().max(240).optional(),
});

type CallSignalType = 'ringing' | 'accepted' | 'declined' | 'ended' | 'offer' | 'answer' | 'ice' | 'hold' | 'resume';
type CallSignalEvent = {
  seq: number;
  callId: string;
  fromUserId: string;
  toUserId: string | null;
  type: CallSignalType;
  payload: Record<string, unknown>;
  createdAt: string;
};

type CallSignalHub = {
  members: Set<string>;
  seq: number;
  events: CallSignalEvent[];
  expiresAtMs: number;
};

const CALL_SIGNAL_TTL_MS = 1000 * 60 * 45;
const CALL_SIGNAL_MAX_EVENTS = 500;
const CALL_STALE_RINGING_MS = 40 * 1000;
const CALL_STALE_ACTIVE_MS = 75 * 1000;
const callSignalHubs = new Map<string, CallSignalHub>();

function cleanupCallSignalHubs() {
  const now = Date.now();
  for (const [callId, hub] of callSignalHubs.entries()) {
    if (hub.expiresAtMs < now) {
      callSignalHubs.delete(callId);
    }
  }
}

function ensureCallSignalHub(callId: string, members: string[]) {
  cleanupCallSignalHubs();
  const existing = callSignalHubs.get(callId);
  if (existing) {
    for (const memberId of members) {
      existing.members.add(memberId);
    }
    existing.expiresAtMs = Date.now() + CALL_SIGNAL_TTL_MS;
    return existing;
  }
  const created: CallSignalHub = {
    members: new Set(members),
    seq: 0,
    events: [],
    expiresAtMs: Date.now() + CALL_SIGNAL_TTL_MS,
  };
  callSignalHubs.set(callId, created);
  return created;
}

function publishCallSignal(input: {
  callId: string;
  members: string[];
  fromUserId: string;
  toUserId?: string | null;
  type: CallSignalType;
  payload?: Record<string, unknown>;
}) {
  const hub = ensureCallSignalHub(input.callId, input.members);
  const event: CallSignalEvent = {
    seq: ++hub.seq,
    callId: input.callId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId ?? null,
    type: input.type,
    payload: input.payload ?? {},
    createdAt: new Date().toISOString(),
  };
  hub.events.push(event);
  if (hub.events.length > CALL_SIGNAL_MAX_EVENTS) {
    hub.events.splice(0, hub.events.length - CALL_SIGNAL_MAX_EVENTS);
  }
  hub.expiresAtMs = Date.now() + CALL_SIGNAL_TTL_MS;
  return event;
}

async function cleanupStaleCalls(conversationIds: string[]) {
  if (!conversationIds.length) {
    return;
  }
  const now = new Date();
  const staleRingingBefore = new Date(Date.now() - CALL_STALE_RINGING_MS);
  const staleActiveBefore = new Date(Date.now() - CALL_STALE_ACTIVE_MS);

  await prisma.chatCallSession.updateMany({
    where: {
      conversationId: { in: conversationIds },
      state: 'RINGING',
      startedAt: { lt: staleRingingBefore },
    },
    data: {
      state: 'MISSED',
      endedAt: now,
    },
  });

  await prisma.chatCallSession.updateMany({
    where: {
      conversationId: { in: conversationIds },
      state: 'ACTIVE',
      updatedAt: { lt: staleActiveBefore },
    },
    data: {
      state: 'ENDED',
      endedAt: now,
    },
  });
}

async function resolveUserLabel(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, username: true, email: true },
  });
  return toUserLabel({
    name: user?.name ?? null,
    username: user?.username ?? null,
    email: user?.email ?? null,
  });
}

async function appendSystemChatMessage(input: {
  conversationId: string;
  senderId: string;
  text: string;
  metadata?: Record<string, unknown>;
}) {
  const created = await prisma.chatMessage.create({
    data: {
      conversationId: input.conversationId,
      senderId: input.senderId,
      type: 'SYSTEM',
      body: input.text,
      metadata: input.metadata ?? undefined,
    },
    select: {
      createdAt: true,
    },
  });

  await prisma.chatConversation.update({
    where: { id: input.conversationId },
    data: {
      lastMessageAt: created.createdAt,
      lastMessagePreview: input.text.slice(0, 200),
      updatedAt: new Date(),
    },
  });
}

function buildDirectKey(userA: string, userB: string): string {
  return [userA, userB].sort((left, right) => left.localeCompare(right)).join(':');
}

function toUserLabel(user: Pick<SenderShape, 'name' | 'username' | 'email'>): string {
  return user.name ?? user.username ?? user.email ?? 'Unknown user';
}

function extractObjectKeyFromAttachmentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = '/uploads/attachments/';
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) {
      return null;
    }
    const fileName = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    return fileName ? `attachments/${fileName}` : null;
  } catch {
    return null;
  }
}

function getSelfMessageState(receipts: ReceiptShape[]): ReceiptState {
  if (receipts.some((item) => item.state === 'PLAYED')) {
    return 'PLAYED';
  }
  if (receipts.some((item) => item.state === 'SEEN')) {
    return 'SEEN';
  }
  if (receipts.some((item) => item.state === 'DELIVERED')) {
    return 'DELIVERED';
  }
  return 'SENT';
}

function toMessageResponse(input: {
  id: string;
  body: string;
  type: 'TEXT' | 'TASK' | 'SYSTEM';
  metadata: unknown;
  createdAt: Date;
  senderId: string;
  sender: SenderShape;
  attachments: AttachmentShape[];
  receipts: ReceiptShape[];
}, viewerId: string) {
  const self = input.senderId === viewerId;
  const viewerReceipt = input.receipts.find((item) => item.userId === viewerId);
  return {
    id: input.id,
    type: input.type,
    body: input.body,
    metadata: input.metadata,
    createdAt: input.createdAt.toISOString(),
    sender: {
      id: input.sender.id,
      label: toUserLabel(input.sender),
      avatarUrl: input.sender.avatarUrl,
      username: input.sender.username,
    },
    self,
    state: self ? getSelfMessageState(input.receipts) : (viewerReceipt?.state ?? 'SENT'),
    attachments: input.attachments.map((attachment) => ({
      id: attachment.id,
      kind: attachment.kind,
      url: attachment.url,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes:
        attachment.sizeBytes !== null && attachment.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(attachment.sizeBytes)
          : null,
      expiresAt: attachment.expiresAt?.toISOString() ?? null,
    })),
  };
}

async function assertConversationMember(conversationId: string, userId: string) {
  const membership = await prisma.chatConversationMember.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
    select: {
      role: true,
      lastReadAt: true,
      lastReadMessageId: true,
    },
  });

  if (!membership) {
    return null;
  }

  return membership;
}

async function touchDeliveredReceipts(conversationId: string, viewerId: string) {
  const pending = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      senderId: { not: viewerId },
      receipts: {
        none: { userId: viewerId },
      },
    },
    select: { id: true },
    take: 200,
  });

  if (!pending.length) {
    return;
  }

  await prisma.chatMessageReceipt.createMany({
    data: pending.map((message) => ({
      messageId: message.id,
      userId: viewerId,
      state: 'DELIVERED',
      deliveredAt: new Date(),
    })),
    skipDuplicates: true,
  });
}

export async function discussionsRoutes(server: FastifyInstance) {
  server.get('/discussions/chat/users/search', async (request) => {
    await request.jwtVerify();
    const query = userSearchQuerySchema.parse(request.query ?? {});
    const q = query.q?.trim();
    if (!q || q.length < 2) {
      return { users: [] };
    }

    const isEmailQuery = q.includes('@');
    const normalizedQuery = q.toLowerCase();
    const users = await prisma.user.findMany({
      where: {
        id: { not: request.user.sub },
        OR: isEmailQuery
          ? [
              { email: { equals: q, mode: 'insensitive' } },
              { email: { startsWith: q, mode: 'insensitive' } },
              { username: { equals: q.replace('@', ''), mode: 'insensitive' } },
            ]
          : [
              { name: { contains: q, mode: 'insensitive' } },
              { username: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
      },
      take: 50,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        avatarUrl: true,
      },
    });

    const rankedUsers = users
      .map((user) => {
        const name = (user.name ?? '').toLowerCase();
        const username = (user.username ?? '').toLowerCase();
        const email = (user.email ?? '').toLowerCase();
        const handle = username ? `@${username}` : '';
        let score = 0;

        if (email === normalizedQuery) score += 400;
        if (username === normalizedQuery || handle === normalizedQuery) score += 320;
        if (name === normalizedQuery) score += 280;

        if (email.startsWith(normalizedQuery)) score += 200;
        if (username.startsWith(normalizedQuery)) score += 170;
        if (handle.startsWith(normalizedQuery)) score += 160;
        if (name.startsWith(normalizedQuery)) score += 140;

        if (email.includes(normalizedQuery)) score += 70;
        if (username.includes(normalizedQuery)) score += 60;
        if (name.includes(normalizedQuery)) score += 50;

        return { user, score };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        const leftLabel = left.user.name ?? left.user.username ?? left.user.email ?? '';
        const rightLabel = right.user.name ?? right.user.username ?? right.user.email ?? '';
        return leftLabel.localeCompare(rightLabel);
      })
      .slice(0, 30);

    return {
      users: rankedUsers.map(({ user }) => ({
        id: user.id,
        label: user.name ?? user.username ?? user.email ?? 'Unknown user',
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        subtitle: user.username ? `@${user.username}` : user.email,
      })),
    };
  });

  server.get('/discussions/chat/conversations', async (request) => {
    await request.jwtVerify();
    const query = conversationListQuerySchema.parse(request.query ?? {});
    const userId = request.user.sub;

    const conversations = await prisma.chatConversation.findMany({
      where: {
        members: {
          some: { userId },
        },
        kind:
          query.type === 'direct'
            ? 'DIRECT'
            : query.type === 'group'
              ? 'GROUP'
              : undefined,
        OR: query.q
          ? [
              { name: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
              {
                members: {
                  some: {
                    user: {
                      OR: [
                        { name: { contains: query.q, mode: 'insensitive' } },
                        { username: { contains: query.q, mode: 'insensitive' } },
                        { email: { contains: query.q, mode: 'insensitive' } },
                      ],
                    },
                  },
                },
              },
            ]
          : undefined,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      take: 120,
      select: {
        id: true,
        kind: true,
        name: true,
        description: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        createdAt: true,
        updatedAt: true,
        members: {
          select: {
            userId: true,
            role: true,
            lastReadAt: true,
            user: {
              select: {
                name: true,
                username: true,
                email: true,
                bio: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    const unreadCounts = await Promise.all(
      conversations.map(async (conversation) => {
        const membership = conversation.members.find((item) => item.userId === userId);
        const count = await prisma.chatMessage.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: userId },
            createdAt: membership?.lastReadAt
              ? { gt: membership.lastReadAt }
              : undefined,
          },
        });
        return [conversation.id, count] as const;
      }),
    );
    const unreadMap = new Map(unreadCounts);

    return {
      conversations: conversations.map((conversation) => {
        const otherMember = conversation.kind === 'DIRECT'
          ? conversation.members.find((item) => item.userId !== userId)
          : null;
        const title = conversation.kind === 'DIRECT'
          ? (otherMember ? toUserLabel(otherMember.user) : 'Direct message')
          : (conversation.name ?? 'Group chat');
        return {
          id: conversation.id,
          kind: conversation.kind,
          title,
          description: conversation.description,
          avatarUrl: otherMember?.user.avatarUrl ?? null,
          memberCount: conversation.members.length,
          unreadCount: unreadMap.get(conversation.id) ?? 0,
          lastMessageAt: conversation.lastMessageAt?.toISOString() ?? conversation.updatedAt.toISOString(),
          lastMessagePreview: conversation.lastMessagePreview,
          canCall: true,
        };
      }),
    };
  });

  server.post('/discussions/chat/conversations/direct', async (request, reply) => {
    await request.jwtVerify();
    const body = directConversationSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    if (body.userId === userId) {
      return reply.code(400).send({ message: 'You cannot start a direct chat with yourself.' });
    }

    const target = await prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true },
    });
    if (!target) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const directKey = buildDirectKey(userId, body.userId);
    const existing = await prisma.chatConversation.findUnique({
      where: { directKey },
      select: { id: true },
    });

    if (existing) {
      return { conversationId: existing.id };
    }

    const conversation = await prisma.chatConversation.create({
      data: {
        kind: 'DIRECT',
        directKey,
        createdById: userId,
        members: {
          create: [
            { userId, role: 'ADMIN' },
            { userId: body.userId, role: 'MEMBER' },
          ],
        },
      },
      select: { id: true },
    });

    return { conversationId: conversation.id };
  });

  server.post('/discussions/chat/conversations/group', async (request, reply) => {
    await request.jwtVerify();
    const body = groupConversationSchema.parse(request.body ?? {});
    const creatorId = request.user.sub;

    const distinctMembers = [...new Set(body.memberIds.filter((value) => value !== creatorId))];

    const existingMembers = distinctMembers.length
      ? await prisma.user.findMany({
          where: { id: { in: distinctMembers } },
          select: { id: true },
        })
      : [];

    if (existingMembers.length !== distinctMembers.length) {
      return reply.code(400).send({ message: 'One or more selected members do not exist.' });
    }

    const conversation = await prisma.chatConversation.create({
      data: {
        kind: 'GROUP',
        name: body.name,
        description: body.description,
        createdById: creatorId,
        members: {
          create: [
            { userId: creatorId, role: 'ADMIN' },
            ...distinctMembers.map((memberId) => ({ userId: memberId, role: 'MEMBER' as const })),
          ],
        },
      },
      select: { id: true },
    });

    return { conversationId: conversation.id };
  });

  server.patch('/discussions/chat/conversations/:conversationId', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const body = updateConversationSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: params.conversationId },
      select: { kind: true },
    });

    if (!conversation) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    if (conversation.kind !== 'GROUP') {
      return reply.code(400).send({ message: 'Only group chats can be updated.' });
    }

    if (membership.role !== 'ADMIN') {
      return reply.code(403).send({ message: 'Only group admins can edit this chat.' });
    }

    await prisma.chatConversation.update({
      where: { id: params.conversationId },
      data: {
        name: body.name,
        description: body.description,
      },
    });

    return { ok: true };
  });

  server.post('/discussions/chat/conversations/:conversationId/members', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const body = addMemberSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    if (membership.role !== 'ADMIN') {
      return reply.code(403).send({ message: 'Only group admins can add members.' });
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: params.conversationId },
      select: { kind: true },
    });
    if (!conversation || conversation.kind !== 'GROUP') {
      return reply.code(400).send({ message: 'Members can be managed only for group chats.' });
    }

    const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!target) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    await prisma.chatConversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: params.conversationId,
          userId: body.userId,
        },
      },
      update: {
        role: body.role,
      },
      create: {
        conversationId: params.conversationId,
        userId: body.userId,
        role: body.role,
      },
    });

    return { ok: true };
  });

  server.delete('/discussions/chat/conversations/:conversationId/members/:userId', async (request, reply) => {
    await request.jwtVerify();
    const params = removeMemberParamSchema.parse(request.params ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    if (membership.role !== 'ADMIN' && params.userId !== userId) {
      return reply.code(403).send({ message: 'Only admins can remove other members.' });
    }

    await prisma.chatConversationMember.deleteMany({
      where: {
        conversationId: params.conversationId,
        userId: params.userId,
      },
    });

    return { ok: true };
  });

  server.get('/discussions/chat/conversations/:conversationId/profile', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const viewerId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, viewerId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: params.conversationId },
      select: {
        id: true,
        kind: true,
        name: true,
        description: true,
        createdAt: true,
        members: {
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            joinedAt: true,
            userId: true,
            user: {
              select: {
                name: true,
                username: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const directPeer = conversation.kind === 'DIRECT'
      ? conversation.members.find((item) => item.userId !== viewerId)
      : null;

    return {
      profile: {
        id: conversation.id,
        kind: conversation.kind,
        title:
          conversation.kind === 'DIRECT'
            ? (directPeer ? toUserLabel(directPeer.user) : 'Direct message')
            : (conversation.name ?? 'Group chat'),
        description: conversation.description,
        createdAt: conversation.createdAt.toISOString(),
        members: conversation.members.map((item) => ({
          id: item.userId,
          label: toUserLabel(item.user),
          username: item.user.username,
          email: item.user.email,
          bio: item.user.bio,
          avatarUrl: item.user.avatarUrl,
          role: item.role,
          joinedAt: item.joinedAt.toISOString(),
        })),
      },
    };
  });

  server.get('/discussions/chat/conversations/:conversationId/media', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const query = mediaQuerySchema.parse(request.query ?? {});
    const viewerId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, viewerId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const items = await prisma.chatAttachment.findMany({
      where: {
        message: {
          conversationId: params.conversationId,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: query.offset,
      take: query.limit + 1,
      select: {
        id: true,
        messageId: true,
        kind: true,
        url: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const hasMore = items.length > query.limit;
    const visibleItems = hasMore ? items.slice(0, query.limit) : items;

    return {
      items: visibleItems.map((item) => ({
        id: item.id,
        messageId: item.messageId,
        kind: item.kind,
        url: item.url,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes ? Number(item.sizeBytes) : null,
        expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
      })),
      hasMore,
      nextOffset: hasMore ? query.offset + query.limit : null,
    };
  });

  server.get('/discussions/chat/conversations/:conversationId/messages', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const query = messagesQuerySchema.parse(request.query ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    await touchDeliveredReceipts(params.conversationId, userId);

    const messages = await prisma.chatMessage.findMany({
      where: {
        conversationId: params.conversationId,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        type: true,
        body: true,
        metadata: true,
        createdAt: true,
        senderId: true,
        sender: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            avatarUrl: true,
          },
        },
        attachments: {
          select: {
            id: true,
            kind: true,
            url: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            expiresAt: true,
          },
        },
        receipts: {
          select: {
            userId: true,
            state: true,
          },
        },
      },
    });

    const nextCursor = messages.length === query.limit ? messages[messages.length - 1]?.id ?? null : null;

    const ordered = [...messages].reverse();

    return {
      messages: ordered.map((item) => toMessageResponse(item, userId)),
      nextCursor,
    };
  });

  server.get('/discussions/chat/attachments/:attachmentId', async (request, reply) => {
    await request.jwtVerify();
    const params = attachmentParamSchema.parse(request.params ?? {});
    const viewerId = request.user.sub;

    const attachment = await prisma.chatAttachment.findUnique({
      where: { id: params.attachmentId },
      select: {
        id: true,
        url: true,
        fileName: true,
        mimeType: true,
        expiresAt: true,
        message: {
          select: {
            conversationId: true,
          },
        },
      },
    });
    if (!attachment) {
      return reply.code(404).send({ message: 'Attachment not found.' });
    }

    const membership = await assertConversationMember(attachment.message.conversationId, viewerId);
    if (!membership) {
      return reply.code(404).send({ message: 'Attachment not found.' });
    }

    if (attachment.expiresAt && attachment.expiresAt <= new Date()) {
      const objectKey = extractObjectKeyFromAttachmentUrl(attachment.url);
      if (objectKey) {
        await deleteObject(objectKey).catch(() => null);
      }
      await prisma.chatAttachment.delete({ where: { id: attachment.id } }).catch(() => null);
      return reply.code(410).send({ message: 'Attachment expired.' });
    }

    const objectKey = extractObjectKeyFromAttachmentUrl(attachment.url);
    if (!objectKey) {
      return reply.redirect(attachment.url);
    }
    const object = await getObject(objectKey).catch(() => null);
    if (!object?.body) {
      return reply.code(404).send({ message: 'Attachment not found.' });
    }

    if (object.contentLength) {
      reply.header('content-length', object.contentLength);
    }
    if (attachment.fileName) {
      reply.header('content-disposition', `attachment; filename="${attachment.fileName.replace(/"/g, '')}"`);
    }
    return reply.type(attachment.mimeType ?? object.contentType).send(object.body);
  });

  server.post('/discussions/chat/conversations/:conversationId/messages', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const body = sendMessageSchema.parse(request.body ?? {});
    const senderId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, senderId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const text = body.body?.trim() ?? '';
    const hasAttachments = Boolean(body.attachments?.length);
    const hasTask = Boolean(body.task);
    if (!text && !hasAttachments && !hasTask) {
      return reply.code(400).send({ message: 'Message body or attachment is required.' });
    }

    if (body.task?.assigneeUserId) {
      const assigneeMember = await prisma.chatConversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: params.conversationId,
            userId: body.task.assigneeUserId,
          },
        },
        select: { userId: true },
      });
      if (!assigneeMember) {
        return reply.code(400).send({ message: 'Task assignee must be a conversation member.' });
      }
    }

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: params.conversationId },
      select: { userId: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          conversationId: params.conversationId,
          senderId,
          type: body.task ? 'TASK' : 'TEXT',
          body: text,
          metadata: {
            mentions: body.mentions ?? [],
            task: body.task
              ? {
                  title: body.task.title,
                  assigneeUserId: body.task.assigneeUserId ?? null,
                  dueAt: body.task.dueAt ?? null,
                  status: body.task.status,
                }
              : null,
          },
          attachments: body.attachments?.length
            ? {
                create: body.attachments.map((attachment) => ({
                  kind: attachment.kind,
                  url: attachment.url,
                  fileName: attachment.fileName,
                  mimeType: attachment.mimeType,
                  sizeBytes:
                    attachment.sizeBytes !== undefined ? BigInt(attachment.sizeBytes) : undefined,
                  expiresAt: attachment.expiresAt ? new Date(attachment.expiresAt) : null,
                })),
              }
            : undefined,
          receipts: {
            create: members
              .filter((member) => member.userId !== senderId)
              .map((member) => ({
                userId: member.userId,
                state: 'SENT' as const,
              })),
          },
        },
        select: {
          id: true,
          type: true,
          body: true,
          metadata: true,
          createdAt: true,
          senderId: true,
          sender: {
            select: {
              id: true,
              name: true,
              username: true,
              email: true,
              avatarUrl: true,
            },
          },
          attachments: {
            select: {
              id: true,
              kind: true,
              url: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              expiresAt: true,
            },
          },
          receipts: {
            select: {
              userId: true,
              state: true,
            },
          },
        },
      });

      const preview =
        text ||
        (body.attachments?.length ? `[${body.attachments[0].kind.toLowerCase()}]` : '[task]');

      await tx.chatConversation.update({
        where: { id: params.conversationId },
        data: {
          lastMessageAt: message.createdAt,
          lastMessagePreview: preview.slice(0, 200),
          updatedAt: new Date(),
        },
      });

      return message;
    });

    if (text.includes('@')) {
      void createMentionNotifications({
        actorId: senderId,
        title: 'You were mentioned in chat',
        body: text.slice(0, 180),
        texts: [text],
      }).catch(() => null);
    }

    return { message: toMessageResponse(created, senderId) };
  });

  server.post('/discussions/chat/conversations/:conversationId/read', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const body = readConversationSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    let pivotCreatedAt = new Date();
    if (body.messageId) {
      const pivot = await prisma.chatMessage.findFirst({
        where: {
          id: body.messageId,
          conversationId: params.conversationId,
        },
        select: {
          id: true,
          createdAt: true,
        },
      });
      if (!pivot) {
        return reply.code(404).send({ message: 'Message not found.' });
      }
      pivotCreatedAt = pivot.createdAt;
    }

    await prisma.$transaction(async (tx) => {
      await tx.chatConversationMember.update({
        where: {
          conversationId_userId: {
            conversationId: params.conversationId,
            userId,
          },
        },
        data: {
          lastReadAt: pivotCreatedAt,
          lastReadMessageId: body.messageId,
        },
      });

      const messageIds = await tx.chatMessage.findMany({
        where: {
          conversationId: params.conversationId,
          senderId: { not: userId },
          createdAt: { lte: pivotCreatedAt },
        },
        select: { id: true },
        take: 500,
      });

      if (messageIds.length) {
        await tx.chatMessageReceipt.createMany({
          data: messageIds.map((item) => ({
            messageId: item.id,
            userId,
            state: 'SEEN',
            deliveredAt: new Date(),
            seenAt: new Date(),
          })),
          skipDuplicates: true,
        });

        await tx.chatMessageReceipt.updateMany({
          where: {
            userId,
            messageId: { in: messageIds.map((item) => item.id) },
          },
          data: {
            state: 'SEEN',
            deliveredAt: new Date(),
            seenAt: new Date(),
          },
        });
      }
    });

    return { ok: true };
  });

  server.post('/discussions/chat/messages/:messageId/played', async (request, reply) => {
    await request.jwtVerify();
    const params = messageParamSchema.parse(request.params ?? {});
    const userId = request.user.sub;

    const message = await prisma.chatMessage.findUnique({
      where: { id: params.messageId },
      select: {
        id: true,
        senderId: true,
        conversationId: true,
      },
    });

    if (!message) {
      return reply.code(404).send({ message: 'Message not found.' });
    }

    const membership = await assertConversationMember(message.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    if (message.senderId === userId) {
      return reply.code(400).send({ message: 'Sender cannot mark own message as played.' });
    }

    await prisma.chatMessageReceipt.upsert({
      where: {
        messageId_userId: {
          messageId: params.messageId,
          userId,
        },
      },
      update: {
        state: 'PLAYED',
        deliveredAt: new Date(),
        seenAt: new Date(),
        playedAt: new Date(),
      },
      create: {
        messageId: params.messageId,
        userId,
        state: 'PLAYED',
        deliveredAt: new Date(),
        seenAt: new Date(),
        playedAt: new Date(),
      },
    });

    return { ok: true };
  });

  server.get('/discussions/chat/conversations/:conversationId/calls/active', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: params.conversationId },
      select: { kind: true },
    });
    if (!conversation || conversation.kind !== 'DIRECT') {
      await prisma.chatCallSession.updateMany({
        where: {
          conversationId: params.conversationId,
          state: { in: ['RINGING', 'ACTIVE'] },
        },
        data: {
          state: 'ENDED',
          endedAt: new Date(),
        },
      });
      return { call: null };
    }

    await cleanupStaleCalls([params.conversationId]);

    const call = await prisma.chatCallSession.findFirst({
      where: {
        conversationId: params.conversationId,
        state: { in: ['RINGING', 'ACTIVE'] },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        state: true,
        startedAt: true,
        startedById: true,
      },
    });

    if (!call) {
      return { call: null };
    }

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: params.conversationId },
      select: { userId: true },
    });

    ensureCallSignalHub(call.id, members.map((item) => item.userId));

    return {
      call: {
        id: call.id,
        mode: call.mode,
        state: call.state,
        startedAt: call.startedAt.toISOString(),
        startedById: call.startedById,
      },
    };
  });

  server.post('/discussions/chat/conversations/:conversationId/calls', async (request, reply) => {
    await request.jwtVerify();
    const params = conversationParamSchema.parse(request.params ?? {});
    const body = callSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const membership = await assertConversationMember(params.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: params.conversationId },
      select: {
        kind: true,
        members: {
          select: { userId: true },
        },
      },
    });
    if (!conversation) {
      return reply.code(404).send({ message: 'Conversation not found.' });
    }
    if (conversation.kind !== 'DIRECT') {
      return reply.code(400).send({ message: 'Group calls are not available yet.' });
    }
    const members = conversation.members;

    if (members.length < 2) {
      return reply.code(400).send({ message: 'At least two members are required for a call.' });
    }

    const memberIds = members.map((item) => item.userId);
    const memberConversationIds = await prisma.chatConversationMember.findMany({
      where: {
        userId: { in: memberIds },
      },
      select: { conversationId: true },
    });
    const candidateConversationIds = Array.from(
      new Set(memberConversationIds.map((item) => item.conversationId)),
    );
    await cleanupStaleCalls(candidateConversationIds);

    const activeCall = await prisma.chatCallSession.findFirst({
      where: {
        state: { in: ['RINGING', 'ACTIVE'] },
        conversation: {
          members: {
            some: {
              userId: { in: memberIds },
            },
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, conversationId: true },
    });
    if (activeCall) {
      return reply
        .code(409)
        .send({ message: 'A call is already active. End it before starting another one.' });
    }

    const call = await prisma.chatCallSession.create({
      data: {
        conversationId: params.conversationId,
        startedById: userId,
        mode: body.mode,
        state: 'RINGING',
      },
      select: {
        id: true,
        mode: true,
        state: true,
        startedAt: true,
      },
    });

    const callerLabel = await resolveUserLabel(userId);
    await appendSystemChatMessage({
      conversationId: params.conversationId,
      senderId: userId,
      text: `${callerLabel} started a ${body.mode === 'VIDEO' ? 'video' : 'audio'} call.`,
      metadata: {
        callId: call.id,
        mode: body.mode,
        event: 'CALL_STARTED',
      },
    });

    for (const targetId of memberIds.filter((memberId) => memberId !== userId)) {
      publishCallSignal({
        callId: call.id,
        members: memberIds,
        fromUserId: userId,
        toUserId: targetId,
        type: 'ringing',
      });
    }

    return {
      call: {
        id: call.id,
        mode: call.mode,
        state: call.state,
        startedAt: call.startedAt.toISOString(),
        joinUrl: `/discussions?call=${call.id}&conversation=${params.conversationId}`,
        participantIds: memberIds,
      },
    };
  });

  server.get('/discussions/chat/calls/:callId/events', async (request, reply) => {
    await request.jwtVerify();
    const params = callIdParamSchema.parse(request.params ?? {});
    const query = callEventsQuerySchema.parse(request.query ?? {});
    const userId = request.user.sub;

    const call = await prisma.chatCallSession.findUnique({
      where: { id: params.callId },
      select: { id: true, conversationId: true },
    });
    if (!call) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const membership = await assertConversationMember(call.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: call.conversationId },
      select: { userId: true },
    });
    const memberIds = members.map((item) => item.userId);
    const hub = ensureCallSignalHub(params.callId, memberIds);
    const events = hub.events.filter(
      (event) => event.seq > query.cursor && (event.toUserId === null || event.toUserId === userId),
    );

    return {
      cursor: hub.seq,
      events,
    };
  });

  server.get('/discussions/chat/calls/incoming', async (request) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const memberships = await prisma.chatConversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
      take: 300,
    });
    const conversationIds = memberships.map((item) => item.conversationId);
    if (!conversationIds.length) {
      return { call: null };
    }
    await cleanupStaleCalls(conversationIds);

    const call = await prisma.chatCallSession.findFirst({
      where: {
        conversationId: { in: conversationIds },
        state: 'RINGING',
        startedById: { not: userId },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        state: true,
        startedAt: true,
        startedById: true,
        conversationId: true,
      },
    });

    if (!call) {
      return { call: null };
    }

    return {
      call: {
        id: call.id,
        mode: call.mode,
        state: call.state,
        startedAt: call.startedAt.toISOString(),
        startedById: call.startedById,
        conversationId: call.conversationId,
      },
    };
  });

  server.get('/discussions/chat/calls/current', async (request) => {
    await request.jwtVerify();
    const userId = request.user.sub;
    const memberships = await prisma.chatConversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
      take: 300,
    });
    const conversationIds = memberships.map((item) => item.conversationId);
    if (!conversationIds.length) {
      return { call: null };
    }
    await cleanupStaleCalls(conversationIds);

    const call = await prisma.chatCallSession.findFirst({
      where: {
        conversationId: { in: conversationIds },
        state: { in: ['RINGING', 'ACTIVE'] },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        state: true,
        startedAt: true,
        startedById: true,
        conversationId: true,
      },
    });

    if (!call) {
      return { call: null };
    }

    return {
      call: {
        id: call.id,
        mode: call.mode,
        state: call.state,
        startedAt: call.startedAt.toISOString(),
        startedById: call.startedById,
        conversationId: call.conversationId,
      },
    };
  });

  server.post('/discussions/chat/calls/:callId/signal', async (request, reply) => {
    await request.jwtVerify();
    const params = callIdParamSchema.parse(request.params ?? {});
    const body = callSignalSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const call = await prisma.chatCallSession.findUnique({
      where: { id: params.callId },
      select: {
        id: true,
        conversationId: true,
        state: true,
      },
    });
    if (!call || call.state === 'ENDED' || call.state === 'MISSED') {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const membership = await assertConversationMember(call.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: call.conversationId },
      select: { userId: true },
    });
    const memberIds = members.map((item) => item.userId);
    if (!memberIds.includes(userId)) {
      return reply.code(403).send({ message: 'Not allowed.' });
    }
    if (body.targetUserId && !memberIds.includes(body.targetUserId)) {
      return reply.code(400).send({ message: 'Invalid signal target.' });
    }

    publishCallSignal({
      callId: call.id,
      members: memberIds,
      fromUserId: userId,
      toUserId: body.targetUserId ?? null,
      type: body.type,
      payload: {
        sdp: body.sdp,
        hold: body.hold,
        candidate: body.candidate,
      },
    });

    return { ok: true };
  });

  server.post('/discussions/chat/calls/:callId/accept', async (request, reply) => {
    await request.jwtVerify();
    const params = callIdParamSchema.parse(request.params ?? {});
    const userId = request.user.sub;

    const call = await prisma.chatCallSession.findUnique({
      where: { id: params.callId },
      select: {
        id: true,
        state: true,
        conversationId: true,
      },
    });
    if (!call) {
      return reply.code(404).send({ message: 'Call not found.' });
    }
    if (call.state === 'ENDED' || call.state === 'MISSED') {
      return reply.code(409).send({ message: 'Call already finished.' });
    }

    const membership = await assertConversationMember(call.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    await prisma.chatCallSession.update({
      where: { id: params.callId },
      data: { state: 'ACTIVE' },
    });

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: call.conversationId },
      select: { userId: true },
    });
    const memberIds = members.map((item) => item.userId);
    const callerLabel = await resolveUserLabel(userId);
    await appendSystemChatMessage({
      conversationId: call.conversationId,
      senderId: userId,
      text: `${callerLabel} joined the call.`,
      metadata: {
        callId: call.id,
        event: 'CALL_ACCEPTED',
      },
    });
    publishCallSignal({
      callId: call.id,
      members: memberIds,
      fromUserId: userId,
      type: 'accepted',
    });

    return { ok: true };
  });

  server.post('/discussions/chat/calls/:callId/heartbeat', async (request, reply) => {
    await request.jwtVerify();
    const params = callIdParamSchema.parse(request.params ?? {});
    const userId = request.user.sub;

    const call = await prisma.chatCallSession.findUnique({
      where: { id: params.callId },
      select: {
        id: true,
        state: true,
        conversationId: true,
      },
    });
    if (!call || !['RINGING', 'ACTIVE'].includes(call.state)) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const membership = await assertConversationMember(call.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    await prisma.chatCallSession.update({
      where: { id: call.id },
      data: {
        updatedAt: new Date(),
      },
    });

    return { ok: true };
  });

  server.post('/discussions/chat/calls/:callId/end', async (request, reply) => {
    await request.jwtVerify();
    const params = callIdParamSchema.parse(request.params ?? {});
    const body = callActionSchema.parse(request.body ?? {});
    const userId = request.user.sub;

    const call = await prisma.chatCallSession.findUnique({
      where: { id: params.callId },
      select: {
        id: true,
        state: true,
        conversationId: true,
      },
    });
    if (!call) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    const membership = await assertConversationMember(call.conversationId, userId);
    if (!membership) {
      return reply.code(404).send({ message: 'Call not found.' });
    }

    if (call.state !== 'ENDED') {
      await prisma.chatCallSession.update({
        where: { id: call.id },
        data: {
          state: 'ENDED',
          endedAt: new Date(),
        },
      });
    }

    const members = await prisma.chatConversationMember.findMany({
      where: { conversationId: call.conversationId },
      select: { userId: true },
    });
    const memberIds = members.map((item) => item.userId);
    const callerLabel = await resolveUserLabel(userId);
    const reason = body.reason?.trim();
    const endText = reason === 'declined'
      ? `${callerLabel} declined the call.`
      : `${callerLabel} ended the call.`;
    await appendSystemChatMessage({
      conversationId: call.conversationId,
      senderId: userId,
      text: endText,
      metadata: {
        callId: call.id,
        event: reason === 'declined' ? 'CALL_DECLINED' : 'CALL_ENDED',
      },
    });

    publishCallSignal({
      callId: call.id,
      members: memberIds,
      fromUserId: userId,
      type: 'ended',
      payload: body.reason ? { reason: body.reason } : {},
    });

    return { ok: true };
  });
}
