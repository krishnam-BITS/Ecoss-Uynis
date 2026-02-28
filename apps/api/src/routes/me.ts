import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '@uynis/db';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { clearPasswordResetRequirement, clearStepUpRequirement } from '../lib/security.js';
import { invalidateSessionCacheByTokenId, revokeUserSessions } from '../lib/sessions.js';
import { resolveDisplayName, resolveIsVerified } from '../lib/user-account.js';
import { deleteObject, putObject } from '../lib/object-store.js';
import { createPersonalAccessToken } from '../lib/pats.js';
import { requireAuthenticatedUserId } from '../lib/auth.js';
import { OtpSendRateLimitError, sendOtpChallenge, verifyOtpChallenge } from '../lib/otp-service.js';
import { isConfiguredSystemAdmin } from '../lib/system-admin.js';

const optionalUrl = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().url().max(500).optional());

const optionalTrimmedString = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }, z.string().max(max).optional());

const notificationsQuerySchema = z.object({
  tab: z.enum(['inbox', 'mentions', 'reviews', 'system']).optional(),
  status: z.enum(['all', 'unread']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const toggleNotificationReadSchema = z.object({
  read: z.boolean().optional(),
});

const markAllNotificationsSchema = z.object({
  tab: z.enum(['inbox', 'mentions', 'reviews', 'system']).optional(),
});

const repoNotificationPreferencesQuerySchema = z.object({
  mode: z.enum(['DEFAULT', 'WATCH', 'MUTE']).optional(),
});

const revokeSessionParamsSchema = z.object({
  sessionId: z.string().min(1),
});

const patScopeSchema = z.enum([
  'repo:read',
  'repo:write',
  'repo:admin',
  'platform:admin',
  // Backward-compat alias for old clients/tokens.
  'admin',
]);

const createPatSchema = z
  .object({
    name: z.string().min(1).max(80),
    scopes: z.array(patScopeSchema).min(1).max(8).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((data) => !(data.expiresAt && data.expiresInDays), {
    message: 'Provide expiresAt or expiresInDays, not both.',
  });

const revokePatParamsSchema = z.object({
  tokenId: z.string().min(1),
});

const securityEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function sanitizeBranchRef(value: string | null | undefined): string {
  const fallback = 'main';
  if (typeof value !== 'string') {
    return fallback;
  }
  const withoutDelimiter = value.split('%x1f')[0] ?? value;
  const trimmed = withoutDelimiter
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return trimmed.length ? trimmed : fallback;
}

function canIssuePlatformAdminPat(viewer: { id: string; email: string | null }): boolean {
  return isConfiguredSystemAdmin(viewer);
}

const normalizedPatScopeOrder: Array<'repo:read' | 'repo:write' | 'repo:admin' | 'platform:admin'> = [
  'repo:read',
  'repo:write',
  'repo:admin',
  'platform:admin',
];

function normalizePatScopes(input: Array<z.infer<typeof patScopeSchema>>) {
  const mapped = input.map((scope) => (scope === 'admin' ? 'platform:admin' : scope));
  const unique = Array.from(new Set(mapped));
  return normalizedPatScopeOrder.filter((scope) => unique.includes(scope));
}

const notificationPreferenceSelect = {
  id: true,
  userId: true,
  inAppActivityEnabled: true,
  mentionsEnabled: true,
  reviewRequestsEnabled: true,
  reviewSubmittedEnabled: true,
  issueCommentsEnabled: true,
  pullCommentsEnabled: true,
  pullStatusEnabled: true,
  systemEnabled: true,
  emailMentionsEnabled: true,
  emailReviewsEnabled: true,
  productUpdatesEnabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

const updateNotificationPreferencesSchema = z
  .object({
    inAppActivityEnabled: z.boolean().optional(),
    mentionsEnabled: z.boolean().optional(),
    reviewRequestsEnabled: z.boolean().optional(),
    reviewSubmittedEnabled: z.boolean().optional(),
    issueCommentsEnabled: z.boolean().optional(),
    pullCommentsEnabled: z.boolean().optional(),
    pullStatusEnabled: z.boolean().optional(),
    systemEnabled: z.boolean().optional(),
    emailMentionsEnabled: z.boolean().optional(),
    emailReviewsEnabled: z.boolean().optional(),
    productUpdatesEnabled: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'No updates provided.',
  });

const meSelect = {
  id: true,
  email: true,
  phone: true,
  name: true,
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  username: true,
  avatarUrl: true,
  bio: true,
  location: true,
  website: true,
  isVerified: true,
  verificationExpiresAt: true,
  emailVerificationExpiresAt: true,
  phoneVerificationExpiresAt: true,
  pendingEmail: true,
  pendingPhone: true,
  contactVerificationExpiresAt: true,
  emailVerified: true,
  phoneVerified: true,
  createdAt: true,
  privateAccount: {
    select: {
      id: true,
      expiresAt: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      recoveryEmail: true,
      recoveryPhone: true,
    },
  },
} as const;

const avatarPrefix = '/uploads/avatars/';
const maxAvatarBytes = 5 * 1024 * 1024;
const avatarMimeTypes: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function resolveAvatarFilePath(avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl) {
    return null;
  }

  let pathName = avatarUrl;
  if (!avatarUrl.startsWith('/')) {
    try {
      pathName = new URL(avatarUrl).pathname;
    } catch {
      pathName = avatarUrl;
    }
  }

  if (!pathName.startsWith(avatarPrefix)) {
    return null;
  }

  const filename = pathName.slice(avatarPrefix.length);
  if (!filename || filename !== path.basename(filename)) {
    return null;
  }
  return `avatars/${filename}`;
}

async function getOrCreateNotificationPreference(userId: string) {
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: notificationPreferenceSelect,
  });
}

export async function meRoutes(server: FastifyInstance) {
  server.get('/me', async (request) => {
    const userId = await requireAuthenticatedUserId(request);

    let user = await prisma.user.findUnique({
      where: { id: userId },
      select: meSelect,
    });

    if (
      user?.contactVerificationExpiresAt &&
      user.contactVerificationExpiresAt < new Date() &&
      (user.pendingEmail || user.pendingPhone)
    ) {
      user = await prisma.user.update({
        where: { id: userId },
        data: {
          pendingEmail: null,
          pendingPhone: null,
          contactVerificationExpiresAt: null,
        },
        select: meSelect,
      });
    }

    if (user) {
      const nextName = resolveDisplayName({
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        email: user.email,
        phone: user.phone,
        fallbackId: user.id,
      });
      const nextIsVerified = resolveIsVerified({
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        hasPrivateAccount: Boolean(user.privateAccount),
      });

      const updateData: {
        name?: string;
        isVerified?: boolean;
        verificationExpiresAt?: null;
        emailVerificationExpiresAt?: null;
        phoneVerificationExpiresAt?: null;
      } = {};

      if (!(user.name ?? '').trim()) {
        updateData.name = nextName;
      }
      if (user.isVerified !== nextIsVerified) {
        updateData.isVerified = nextIsVerified;
      }
      if (nextIsVerified && user.verificationExpiresAt) {
        updateData.verificationExpiresAt = null;
      }
      if (nextIsVerified && user.emailVerificationExpiresAt) {
        updateData.emailVerificationExpiresAt = null;
      }
      if (nextIsVerified && user.phoneVerificationExpiresAt) {
        updateData.phoneVerificationExpiresAt = null;
      }

      if (Object.keys(updateData).length) {
        user = await prisma.user.update({
          where: { id: userId },
          data: updateData,
          select: meSelect,
        });
      }
    }

    return { user };
  });

  server.post('/me/avatar', async (request, reply) => {
    await request.jwtVerify();
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ message: 'Avatar file is required.' });
    }
    if (data.fieldname && data.fieldname !== 'avatar') {
      return reply.code(400).send({ message: 'Invalid upload field.' });
    }

    const extension = avatarMimeTypes[data.mimetype];
    if (!extension) {
      return reply
        .code(400)
        .send({ message: 'Avatar must be a JPG, PNG, or WebP image.' });
    }

    const buffer = await data.toBuffer();
    if (!buffer.length) {
      return reply.code(400).send({ message: 'Avatar file is empty.' });
    }
    if (buffer.length > maxAvatarBytes) {
      return reply
        .code(400)
        .send({ message: 'Avatar must be smaller than 5MB.' });
    }

    const filename = `${request.user.sub}-${Date.now()}-${randomUUID().slice(
      0,
      8,
    )}.${extension}`;
    const objectKey = `avatars/${filename}`;
    const avatarUrl = `${avatarPrefix}${filename}`;

    const existing = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { avatarUrl: true },
    });

    try {
      await putObject({
        key: objectKey,
        body: buffer,
        contentType: data.mimetype,
      });
      const user = await prisma.user.update({
        where: { id: request.user.sub },
        data: { avatarUrl },
        select: meSelect,
      });

      const previousPath = resolveAvatarFilePath(existing?.avatarUrl);
      if (previousPath && previousPath !== objectKey) {
        await deleteObject(previousPath);
      }

      return { user };
    } catch (error) {
      await deleteObject(objectKey);
      throw error;
    }
  });

  server.delete('/me/avatar', async (request) => {
    await request.jwtVerify();

    const existing = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { avatarUrl: true },
    });

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: { avatarUrl: null },
      select: meSelect,
    });

    const previousPath = resolveAvatarFilePath(existing?.avatarUrl);
    if (previousPath) {
      await deleteObject(previousPath);
    }

    return { user };
  });

  server.get('/me/pinned-repos', async (request) => {
    await request.jwtVerify();

    const pins = await prisma.repoPin.findMany({
      where: {
        userId: request.user.sub,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        sortOrder: true,
        createdAt: true,
        repo: {
          select: {
            id: true,
            workspaceId: true,
            name: true,
            slug: true,
            visibility: true,
            defaultBranch: true,
            forkedFromRepoId: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
                isPersonal: true,
              },
            },
            forkedFrom: {
              select: {
                id: true,
                name: true,
                slug: true,
                workspaceId: true,
                workspace: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                  },
                },
              },
            },
            _count: {
              select: {
                stars: true,
                forks: true,
                notificationPreferences: true,
              },
            },
            stars: {
              where: {
                userId: request.user.sub,
              },
              select: {
                id: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    return {
      pinned: pins.map((pin) => ({
        id: pin.id,
        sortOrder: pin.sortOrder,
        pinnedAt: pin.createdAt,
        viewerHasPin: true,
        repo: {
          id: pin.repo.id,
          workspaceId: pin.repo.workspaceId,
          name: pin.repo.name,
          slug: pin.repo.slug,
          visibility: pin.repo.visibility,
          defaultBranch: sanitizeBranchRef(pin.repo.defaultBranch),
          forkedFromRepoId: pin.repo.forkedFromRepoId,
          forkedFrom: pin.repo.forkedFrom
            ? {
                ...pin.repo.forkedFrom,
              }
            : null,
          starsCount: pin.repo._count.stars,
          forksCount: pin.repo._count.forks,
          viewsCount: pin.repo._count.notificationPreferences,
          viewerHasStar: Boolean(pin.repo.stars.length),
          workspace: pin.repo.workspace,
        },
      })),
    };
  });

  server.get('/me/notification-preferences', async (request) => {
    await request.jwtVerify();
    const preferences = await getOrCreateNotificationPreference(
      request.user.sub,
    );
    return { preferences };
  });

  server.patch('/me/notification-preferences', async (request, reply) => {
    await request.jwtVerify();
    const body = updateNotificationPreferencesSchema.parse(request.body);

    const existing = await getOrCreateNotificationPreference(request.user.sub);
    if (!existing) {
      return reply.code(404).send({ message: 'Preferences not found.' });
    }

    const preferences = await prisma.notificationPreference.update({
      where: { userId: request.user.sub },
      data: body,
      select: notificationPreferenceSelect,
    });
    return { preferences };
  });

  server.get('/me/repo-notification-preferences', async (request) => {
    await request.jwtVerify();
    const query = repoNotificationPreferencesQuerySchema.parse(request.query);

    const preferences = await prisma.repoNotificationPreference.findMany({
      where: {
        userId: request.user.sub,
        mode: query.mode,
      },
      orderBy: [{ mode: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        mode: true,
        createdAt: true,
        updatedAt: true,
        repo: {
          select: {
            id: true,
            name: true,
            slug: true,
            visibility: true,
            defaultBranch: true,
            workspaceId: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    return {
      preferences: preferences.map((entry) => ({
        ...entry,
        repo: {
          ...entry.repo,
          defaultBranch: sanitizeBranchRef(entry.repo.defaultBranch),
        },
      })),
    };
  });

  server.get('/me/notifications', async (request) => {
    await request.jwtVerify();
    const query = notificationsQuerySchema.parse(request.query);
    const userId = request.user.sub;
    const limit = query.limit ?? 40;

    const tabTypes: Record<
      'mentions' | 'reviews' | 'system',
      Array<'MENTION' | 'REVIEW_REQUESTED' | 'REVIEW_SUBMITTED' | 'SYSTEM'>
    > = {
      mentions: ['MENTION'],
      reviews: ['REVIEW_REQUESTED', 'REVIEW_SUBMITTED'],
      system: ['SYSTEM'],
    };

    const where: {
      recipientId: string;
      readAt?: null;
      type?: { in: string[] };
    } = {
      recipientId: userId,
    };
    if (query.status === 'unread') {
      where.readAt = null;
    }
    if (query.tab && query.tab !== 'inbox') {
      where.type = { in: tabTypes[query.tab] };
    }

    const [
      notifications,
      unreadInbox,
      unreadMentions,
      unreadReviews,
      unreadSystem,
    ] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          workspaceId: true,
          repoId: true,
          issueId: true,
          pullRequestId: true,
          readAt: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
        },
      }),
      prisma.notification.count({
        where: {
          recipientId: userId,
          readAt: null,
        },
      }),
      prisma.notification.count({
        where: {
          recipientId: userId,
          readAt: null,
          type: 'MENTION',
        },
      }),
      prisma.notification.count({
        where: {
          recipientId: userId,
          readAt: null,
          type: {
            in: ['REVIEW_REQUESTED', 'REVIEW_SUBMITTED'],
          },
        },
      }),
      prisma.notification.count({
        where: {
          recipientId: userId,
          readAt: null,
          type: 'SYSTEM',
        },
      }),
    ]);

    return {
      notifications,
      unread: {
        inbox: unreadInbox,
        mentions: unreadMentions,
        reviews: unreadReviews,
        system: unreadSystem,
      },
    };
  });

  server.get('/me/security/events', async (request) => {
    await request.jwtVerify();
    const query = securityEventsQuerySchema.parse(request.query);
    const events = await prisma.securityEvent.findMany({
      where: {
        userId: request.user.sub,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 20,
      select: {
        id: true,
        eventType: true,
        severity: true,
        reason: true,
        ipAddress: true,
        createdAt: true,
      },
    });

    return { events };
  });

  server.post(
    '/me/notifications/:notificationId/read',
    async (request, reply) => {
      await request.jwtVerify();
      const { notificationId } = request.params as { notificationId: string };
      const body = toggleNotificationReadSchema.parse(request.body ?? {});

      const existing = await prisma.notification.findFirst({
        where: {
          id: notificationId,
          recipientId: request.user.sub,
        },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Notification not found.' });
      }

      const read = body.read ?? true;
      const notification = await prisma.notification.update({
        where: { id: notificationId },
        data: {
          readAt: read ? new Date() : null,
        },
        select: {
          id: true,
          readAt: true,
        },
      });

      return { notification };
    },
  );

  server.post('/me/notifications/read-all', async (request) => {
    await request.jwtVerify();
    const body = markAllNotificationsSchema.parse(request.body ?? {});

    const tabTypes: Record<
      'mentions' | 'reviews' | 'system',
      Array<'MENTION' | 'REVIEW_REQUESTED' | 'REVIEW_SUBMITTED' | 'SYSTEM'>
    > = {
      mentions: ['MENTION'],
      reviews: ['REVIEW_REQUESTED', 'REVIEW_SUBMITTED'],
      system: ['SYSTEM'],
    };

    const where: {
      recipientId: string;
      readAt: null;
      type?: { in: string[] };
    } = {
      recipientId: request.user.sub,
      readAt: null,
    };
    if (body.tab && body.tab !== 'inbox') {
      where.type = { in: tabTypes[body.tab] };
    }

    const result = await prisma.notification.updateMany({
      where,
      data: {
        readAt: new Date(),
      },
    });

    return { updated: result.count };
  });

  server.patch('/me', async (request, reply) => {
    await request.jwtVerify();
    const body = z
      .object({
        name: optionalTrimmedString(120),
        bio: optionalTrimmedString(280),
        location: optionalTrimmedString(120),
        website: optionalUrl,
        avatarUrl: optionalUrl,
      })
      .parse(request.body);

    if (
      body.name === undefined &&
      body.bio === undefined &&
      body.location === undefined &&
      body.website === undefined &&
      body.avatarUrl === undefined
    ) {
      return reply.code(400).send({ message: 'No updates provided.' });
    }

    const user = await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        name: body.name,
        bio: body.bio,
        location: body.location,
        website: body.website,
        avatarUrl: body.avatarUrl,
      },
      select: meSelect,
    });

    return { user };
  });

  server.patch('/me/password', async (request, reply) => {
    await request.jwtVerify();
    const body = z
      .object({
        currentPassword: z.string().min(8),
        nextPassword: z.string().min(8),
      })
      .parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { passwordHash: true },
    });

    if (!user || !verifyPassword(body.currentPassword, user.passwordHash)) {
      return reply.code(401).send({ message: 'Invalid credentials.' });
    }

    await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        passwordHash: hashPassword(body.nextPassword),
        passwordChangedAt: new Date(),
      },
    });
    await clearPasswordResetRequirement(request.user.sub);
    await revokeUserSessions({ userId: request.user.sub, exceptTokenId: request.user.jti ?? null });

    return { ok: true };
  });

  server.get('/me/sessions', async (request) => {
    await request.jwtVerify();

    const sessions = await prisma.userSession.findMany({
      where: {
        userId: request.user.sub,
      },
      orderBy: [{ revokedAt: 'asc' }, { lastSeenAt: 'desc' }],
      select: {
        id: true,
        tokenId: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        ipAddress: true,
        userAgent: true,
      },
    });

    return {
      currentTokenId: request.user.jti ?? null,
      sessions,
    };
  });

  server.post('/me/sessions/revoke-others', async (request, reply) => {
    await request.jwtVerify();
    if (!request.user.jti) {
      return reply.code(400).send({ message: 'Session token is missing.' });
    }

    const result = await revokeUserSessions({
      userId: request.user.sub,
      exceptTokenId: request.user.jti,
    });

    return { revoked: result.count };
  });

  server.post('/me/sessions/current/revoke', async (request, reply) => {
    await request.jwtVerify();
    if (!request.user.jti) {
      return reply.code(400).send({ message: 'Session token is missing.' });
    }

    const existing = await prisma.userSession.findFirst({
      where: {
        userId: request.user.sub,
        tokenId: request.user.jti,
      },
      select: {
        id: true,
        tokenId: true,
        revokedAt: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Session not found.' });
    }

    if (!existing.revokedAt) {
      await prisma.userSession.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }

    await invalidateSessionCacheByTokenId(existing.tokenId);

    return { revoked: true };
  });

  server.get('/me/pats', async (request) => {
    const userId = await requireAuthenticatedUserId(request);

    const viewer = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    const canMintPlatformAdmin = viewer ? canIssuePlatformAdminPat(viewer) : false;

    const tokens = await prisma.personalAccessToken.findMany({
      where: { userId },
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    return {
      tokens,
      capabilities: {
        canMintPlatformAdmin,
        availableScopes: canMintPlatformAdmin
          ? ['repo:read', 'repo:write', 'repo:admin', 'platform:admin']
          : ['repo:read', 'repo:write', 'repo:admin'],
      },
    };
  });

  server.post('/me/pats', async (request, reply) => {
    const userId = await requireAuthenticatedUserId(request);
    const body = createPatSchema.parse(request.body ?? {});

    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
        : null;
    if (expiresAt && expiresAt <= new Date()) {
      return reply.code(400).send({ message: 'Token expiry must be in the future.' });
    }

    const scopes = normalizePatScopes(body.scopes?.length ? body.scopes : ['repo:read']);
    if (scopes.includes('platform:admin')) {
      const viewer = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!viewer || !canIssuePlatformAdminPat(viewer)) {
        return reply.code(403).send({ message: 'platform:admin scope is restricted.' });
      }
    }
    const { token, record } = await createPersonalAccessToken({
      userId,
      name: body.name.trim(),
      scopes,
      expiresAt,
    });

    return reply.code(201).send({ token, tokenInfo: record });
  });

  server.delete('/me/pats/:tokenId', async (request, reply) => {
    const userId = await requireAuthenticatedUserId(request);
    const params = revokePatParamsSchema.parse(request.params);

    const existing = await prisma.personalAccessToken.findFirst({
      where: {
        id: params.tokenId,
        userId,
      },
      select: {
        id: true,
        revokedAt: true,
      },
    });
    if (!existing) {
      return reply.code(404).send({ message: 'Token not found.' });
    }

    if (!existing.revokedAt) {
      await prisma.personalAccessToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }

    return { revoked: true };
  });

  server.delete('/me/sessions/:sessionId', async (request, reply) => {
    await request.jwtVerify();
    const params = revokeSessionParamsSchema.parse(request.params);

    const existing = await prisma.userSession.findFirst({
      where: {
        id: params.sessionId,
        userId: request.user.sub,
      },
      select: {
        id: true,
        tokenId: true,
        revokedAt: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Session not found.' });
    }

    if (!existing.revokedAt) {
      await prisma.userSession.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }
    await invalidateSessionCacheByTokenId(existing.tokenId);

    return {
      revoked: true,
      currentSessionRevoked: existing.tokenId === (request.user.jti ?? null),
    };
  });

  server.post('/me/contact/request', async (request, reply) => {
    await request.jwtVerify();
    const body = z
      .object({
        email: z.string().email().optional(),
        phone: z
          .string()
          .regex(/^\+[0-9]{10,15}$/)
          .optional(),
      })
      .refine((data) => data.email || data.phone, {
        message: 'Email or phone is required.',
      })
      .parse(request.body);

    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { email: true, phone: true },
    });

    if (!user) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    if (body.email) {
      if (user.email) {
        return reply
          .code(409)
          .send({ message: 'Email already exists for this account.' });
      }
      const existingEmail = await prisma.user.findUnique({
        where: { email: body.email },
        select: { id: true },
      });
      if (existingEmail) {
        return reply.code(409).send({ message: 'Email already in use.' });
      }
    }

    if (body.phone) {
      if (user.phone) {
        return reply
          .code(409)
          .send({ message: 'Phone already exists for this account.' });
      }
    }

    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        pendingEmail: body.email ?? null,
        pendingPhone: body.phone ?? null,
        contactVerificationExpiresAt: expiresAt,
      },
    });

    const recipient = body.email ?? body.phone;
    if (!recipient) {
      return reply.code(400).send({ message: 'Email or phone is required.' });
    }

    try {
      await sendOtpChallenge({
        purpose: 'CONTACT_VERIFY',
        scopeKey: `contact:${request.user.sub}`,
        channel: body.email ? 'email' : 'phone',
        recipient,
      });
    } catch (error) {
      if (error instanceof OtpSendRateLimitError) {
        return reply.code(429).send({
          message: error.message,
          retryAfterMs: error.retryAfterMs,
        });
      }
      throw error;
    }

    return reply.send({ ok: true });
  });

  server.post('/me/contact/confirm', async (request, reply) => {
    await request.jwtVerify();
    const body = z
      .object({
        otp: z.string().min(1),
      })
      .parse(request.body);

    const verified = verifyOtpChallenge({
      purpose: 'CONTACT_VERIFY',
      scopeKey: `contact:${request.user.sub}`,
      code: body.otp,
    });
    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: request.user.sub },
      select: {
        pendingEmail: true,
        pendingPhone: true,
        contactVerificationExpiresAt: true,
        emailVerified: true,
        phoneVerified: true,
        privateAccount: {
          select: { id: true },
        },
      },
    });

    if (!user) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    if (
      user.contactVerificationExpiresAt &&
      user.contactVerificationExpiresAt < new Date()
    ) {
      await prisma.user.update({
        where: { id: request.user.sub },
        data: {
          pendingEmail: null,
          pendingPhone: null,
          contactVerificationExpiresAt: null,
        },
      });
      return reply
        .code(410)
        .send({ message: 'Verification expired. Please request again.' });
    }

    if (user.pendingEmail) {
      const existingEmail = await prisma.user.findUnique({
        where: { email: user.pendingEmail },
        select: { id: true },
      });
      if (existingEmail) {
        return reply.code(409).send({ message: 'Email already in use.' });
      }
    }

    const nextEmailVerified = user.pendingEmail ? true : user.emailVerified;
    const nextPhoneVerified = user.pendingPhone ? true : user.phoneVerified;
    const nextIsVerified = resolveIsVerified({
      emailVerified: nextEmailVerified,
      phoneVerified: nextPhoneVerified,
      hasPrivateAccount: Boolean(user.privateAccount),
    });
    const updated = await prisma.user.update({
      where: { id: request.user.sub },
      data: {
        email: user.pendingEmail ?? undefined,
        phone: user.pendingPhone ?? undefined,
        pendingEmail: null,
        pendingPhone: null,
        contactVerificationExpiresAt: null,
        emailVerified: nextEmailVerified,
        phoneVerified: nextPhoneVerified,
        isVerified: nextIsVerified,
      },
      select: meSelect,
    });

    await clearStepUpRequirement(request.user.sub);

    return reply.send({ user: updated });
  });
}
