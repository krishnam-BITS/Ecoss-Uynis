
import { prisma, type NotificationType } from '@uynis/db';

type NotificationFanoutInput = {
  recipientIds: string[];
  actorId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  workspaceId?: string | null;
  repoId?: string | null;
  issueId?: string | null;
  pullRequestId?: string | null;
};

type MentionNotificationInput = Omit<NotificationFanoutInput, 'recipientIds' | 'type'> & {
  texts: Array<string | null | undefined>;
};

const mentionToken = /(?:^|\s|[([<{])@([a-z0-9][a-z0-9_.-]{1,38})/gi;

function normalizeMentionUsernames(texts: Array<string | null | undefined>): string[] {
  const usernames = new Set<string>();
  for (const text of texts) {
    if (!text) {
      continue;
    }
    for (const match of text.matchAll(mentionToken)) {
      const username = match[1]?.toLowerCase();
      if (username) {
        usernames.add(username);
      }
    }
  }
  return [...usernames];
}

async function resolveMentionedUserIds(usernames: string[]): Promise<string[]> {
  if (!usernames.length) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      OR: usernames.map((username) => ({
        username: {
          equals: username,
          mode: 'insensitive',
        },
      })),
    },
    select: {
      id: true,
    },
  });

  return users.map((user) => user.id);
}

export async function createNotificationFanout(
  input: NotificationFanoutInput,
): Promise<number> {
  const recipientIds = [...new Set(input.recipientIds)].filter(
    (recipientId) => recipientId && recipientId !== input.actorId,
  );
  if (!recipientIds.length) {
    return 0;
  }

  const now = new Date();
  const result = await prisma.notification.createMany({
    data: recipientIds.map((recipientId) => ({
      recipientId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      workspaceId: input.workspaceId ?? null,
      repoId: input.repoId ?? null,
      issueId: input.issueId ?? null,
      pullRequestId: input.pullRequestId ?? null,
      createdAt: now,
    })),
  });

  return result.count;
}

export async function createMentionNotifications(
  input: MentionNotificationInput,
): Promise<number> {
  const usernames = normalizeMentionUsernames(input.texts);
  if (!usernames.length) {
    return 0;
  }

  const recipientIds = await resolveMentionedUserIds(usernames);
  if (!recipientIds.length) {
    return 0;
  }

  return createNotificationFanout({
    ...input,
    recipientIds,
    type: 'MENTION',
  });
}
