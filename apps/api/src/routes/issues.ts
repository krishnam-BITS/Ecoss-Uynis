import type { FastifyInstance } from 'fastify';
import { prisma } from '@uynis/db';
import { z } from 'zod';
import { requireRepoAccess } from '../lib/repo-access.js';
import { ensureRepoLabels, toLabelKey } from '../lib/repo-labels.js';
import {
  createMentionNotifications,
  createNotificationFanout,
} from '../lib/notifications.js';
import { indexIssueById, searchIssueIds } from '../lib/opensearch.js';
import { enqueueRepoWebhookEvent } from '../lib/repo-webhooks.js';

const assigneeIdsSchema = z.array(z.string().min(1)).max(20);
const labelNamesSchema = z.array(z.string().min(1).max(40)).max(20);

const createIssueSchema = z.object({
  title: z.string().min(2),
  body: z.string().optional(),
  assigneeIds: assigneeIdsSchema.optional(),
  labels: labelNamesSchema.optional(),
});

const updateIssueSchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    assigneeIds: assigneeIdsSchema.optional(),
    labels: labelNamesSchema.optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.assigneeIds !== undefined ||
      value.labels !== undefined,
    { message: 'No updates provided.' },
  );

const issueQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  assigneeId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

const createIssueCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

const issueSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
  authorId: true,
  author: {
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
    },
  },
  assignees: {
    orderBy: { createdAt: 'asc' },
    select: {
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
        },
      },
    },
  },
  labels: {
    orderBy: { createdAt: 'asc' },
    select: {
      label: {
        select: {
          id: true,
          name: true,
          color: true,
        },
      },
    },
  },
} as const;

async function resolveAssignableUsers(input: {
  workspaceId: string;
  repoId: string;
  assigneeIds?: string[];
}) {
  const ids = Array.from(new Set(input.assigneeIds ?? []));
  if (!ids.length) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      id: { in: ids },
      OR: [
        {
          workspaceMemberships: {
            some: {
              workspaceId: input.workspaceId,
            },
          },
        },
        {
          repoMemberships: {
            some: {
              repoId: input.repoId,
            },
          },
        },
      ],
    },
    select: { id: true },
  });

  if (users.length !== ids.length) {
    const available = new Set(users.map((user) => user.id));
    const missing = ids.filter((id) => !available.has(id));
    throw new Error(
      `Invalid assignee(s) for this repository: ${missing.join(', ')}`,
    );
  }

  return ids;
}

function mapIssue(issue: {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
  };
  assignees: Array<{
    userId: string;
    user: {
      id: string;
      name: string | null;
      email: string | null;
      username: string | null;
    };
  }>;
  labels: Array<{
    label: {
      id: string;
      name: string;
      color: string;
    };
  }>;
}) {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    createdAt: issue.createdAt,
    author: {
      id: issue.author.id,
      name: issue.author.name,
      email: issue.author.email ?? '',
      username: issue.author.username,
    },
    assignees: issue.assignees.map((entry) => ({
      id: entry.user.id,
      name: entry.user.name,
      email: entry.user.email ?? '',
      username: entry.user.username,
    })),
    labels: issue.labels.map((entry) => entry.label),
  };
}

function orderBySearchIds<T extends { id: string }>(rows: T[], ids: string[]) {
  if (!ids.length) {
    return rows;
  }
  const rank = new Map(ids.map((id, index) => [id, index]));
  return [...rows].sort((left, right) => {
    const leftRank = rank.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

export async function issueRoutes(server: FastifyInstance) {
  server.get('/workspaces/:workspaceId/repos/:repoId/issues', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = issueQuerySchema.parse(request.query);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }
    const resolvedRepoId = accessResult.access.repo.id;
    const resolvedWorkspaceId = accessResult.access.repo.workspaceId;

    const search = query.q?.trim();
    const searchResult = search
      ? await searchIssueIds({
          q: search,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          limit: 200,
        })
      : null;
    if (search && searchResult?.usedOpenSearch && !searchResult.ids.length) {
      return { issues: [] };
    }
    const issues = await prisma.issue.findMany({
      where: {
        repoId: resolvedRepoId,
        id:
          searchResult?.usedOpenSearch && searchResult.ids.length
            ? { in: searchResult.ids }
            : undefined,
        status: query.status,
        assignees: query.assigneeId
          ? {
              some: {
                userId: query.assigneeId,
              },
            }
          : undefined,
        labels: query.label
          ? {
              some: {
                label: {
                  nameKey: toLabelKey(query.label),
                },
              },
            }
          : undefined,
        OR: search && !searchResult?.usedOpenSearch
          ? [
              {
                title: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                body: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                author: {
                  name: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                author: {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                labels: {
                  some: {
                    label: {
                      name: {
                        contains: search,
                        mode: 'insensitive',
                      },
                    },
                  },
                },
              },
            ]
          : undefined,
      },
      orderBy: { createdAt: 'desc' },
      select: issueSelect,
    });

    const orderedIssues =
      searchResult?.usedOpenSearch && searchResult.ids.length
        ? orderBySearchIds(issues, searchResult.ids)
        : issues;

    return { issues: orderedIssues.map(mapIssue) };
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/issues', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = createIssueSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const resolvedRepoId = accessResult.access.repo.id;
    const resolvedWorkspaceId = accessResult.access.repo.workspaceId;

    let assigneeIds: string[] = [];
    try {
      assigneeIds = await resolveAssignableUsers({
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        assigneeIds: body.assigneeIds,
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Invalid assignees.',
      });
    }

    const issue = await prisma.$transaction(async (tx) => {
        const createdIssue = await tx.issue.create({
          data: {
            repoId: resolvedRepoId,
            authorId: accessResult.userId ?? request.user.sub,
            title: body.title,
            body: body.body,
        },
        select: {
          id: true,
        },
      });

      if (assigneeIds.length) {
        await tx.issueAssignee.createMany({
          data: assigneeIds.map((userId) => ({
            issueId: createdIssue.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      const labels = await ensureRepoLabels(tx, resolvedRepoId, body.labels ?? []);
      if (labels.length) {
        await tx.issueLabel.createMany({
          data: labels.map((label) => ({
            issueId: createdIssue.id,
            labelId: label.id,
          })),
          skipDuplicates: true,
        });
      }

      const fullIssue = await tx.issue.findUnique({
        where: { id: createdIssue.id },
        select: issueSelect,
      });
      if (!fullIssue) {
        throw new Error('Issue not found after creation.');
      }
      return fullIssue;
    });

    await createMentionNotifications({
      texts: [body.title, body.body],
      actorId: accessResult.userId ?? request.user.sub,
      title: `Mentioned in issue: ${issue.title}`,
      body: body.body ?? null,
      workspaceId: resolvedWorkspaceId,
      repoId: resolvedRepoId,
      issueId: issue.id,
    });
    await indexIssueById(issue.id);
    await enqueueRepoWebhookEvent({
      repoId: resolvedRepoId,
      eventType: 'ISSUE_CREATED',
      payload: {
        requestId: request.id,
        actorId: accessResult.userId ?? request.user?.sub ?? null,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        issueId: issue.id,
        title: issue.title,
        status: issue.status,
      },
    });

    return reply.code(201).send({ issue: mapIssue(issue) });
  });

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/issues/:issueId',
    async (request, reply) => {
      const { workspaceId, repoId, issueId } = request.params as {
        workspaceId: string;
        repoId: string;
        issueId: string;
      };
      const body = updateIssueSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }
      const resolvedRepoId = accessResult.access.repo.id;
      const resolvedWorkspaceId = accessResult.access.repo.workspaceId;

      const existing = await prisma.issue.findFirst({
        where: {
          id: issueId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          authorId: true,
        },
      });

      if (!existing) {
        return reply.code(404).send({ message: 'Issue not found.' });
      }

      let assigneeIds: string[] | null = null;
      if (body.assigneeIds !== undefined) {
        try {
          assigneeIds = await resolveAssignableUsers({
            workspaceId: resolvedWorkspaceId,
            repoId: resolvedRepoId,
            assigneeIds: body.assigneeIds,
          });
        } catch (error) {
          return reply.code(400).send({
            message: error instanceof Error ? error.message : 'Invalid assignees.',
          });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (body.status !== undefined) {
          await tx.issue.update({
            where: { id: issueId },
            data: { status: body.status },
          });
        }

        if (assigneeIds !== null) {
          await tx.issueAssignee.deleteMany({
            where: { issueId },
          });
          if (assigneeIds.length) {
            await tx.issueAssignee.createMany({
              data: assigneeIds.map((userId) => ({ issueId, userId })),
              skipDuplicates: true,
            });
          }
        }

        if (body.labels !== undefined) {
          const labels = await ensureRepoLabels(tx, resolvedRepoId, body.labels);
          await tx.issueLabel.deleteMany({
            where: { issueId },
          });
          if (labels.length) {
            await tx.issueLabel.createMany({
              data: labels.map((label) => ({
                issueId,
                labelId: label.id,
              })),
              skipDuplicates: true,
            });
          }
        }

        const issue = await tx.issue.findUnique({
          where: { id: issueId },
          select: issueSelect,
        });
        if (!issue) {
          throw new Error('Issue not found after update.');
        }
        return issue;
      });

      await indexIssueById(updated.id);

      return reply.send({ issue: mapIssue(updated) });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/issues/:issueId/comments',
    async (request, reply) => {
      const { workspaceId, repoId, issueId } = request.params as {
        workspaceId: string;
        repoId: string;
        issueId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
      });
      if (!accessResult) {
        return;
      }
      const resolvedRepoId = accessResult.access.repo.id;
      const resolvedWorkspaceId = accessResult.access.repo.workspaceId;

      const issue = await prisma.issue.findFirst({
        where: {
          id: issueId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: { id: true },
      });

      if (!issue) {
        return reply.code(404).send({ message: 'Issue not found.' });
      }

      const comments = await prisma.issueComment.findMany({
        where: { issueId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
        },
      });

      return reply.send({ comments });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/issues/:issueId/comments',
    async (request, reply) => {
      const { workspaceId, repoId, issueId } = request.params as {
        workspaceId: string;
        repoId: string;
        issueId: string;
      };
      const body = createIssueCommentSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }
      const resolvedRepoId = accessResult.access.repo.id;
      const resolvedWorkspaceId = accessResult.access.repo.workspaceId;

      const issue = await prisma.issue.findFirst({
        where: {
          id: issueId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: { id: true, title: true, authorId: true },
      });

      if (!issue) {
        return reply.code(404).send({ message: 'Issue not found.' });
      }

      const comment = await prisma.issueComment.create({
        data: {
          issueId,
          authorId: accessResult.userId ?? request.user.sub,
          body: body.body,
        },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
        },
      });

      const actorId = accessResult.userId ?? request.user.sub;
      const previousCommenters = await prisma.issueComment.findMany({
        where: { issueId },
        select: { authorId: true },
        distinct: ['authorId'],
      });
      await createNotificationFanout({
        recipientIds: [
          issue.authorId,
          ...previousCommenters.map((entry) => entry.authorId),
        ],
        actorId,
        type: 'ISSUE_COMMENT',
        title: `New comment on issue: ${issue.title}`,
        body: body.body,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        issueId: issue.id,
      });
      await createMentionNotifications({
        texts: [body.body],
        actorId,
        title: `Mentioned in issue comment: ${issue.title}`,
        body: body.body,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        issueId: issue.id,
      });
      await enqueueRepoWebhookEvent({
        repoId: resolvedRepoId,
        eventType: 'COMMENT_ADDED',
        payload: {
          requestId: request.id,
          actorId,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          issueId: issue.id,
          commentId: comment.id,
          commentBody: body.body,
          target: 'issue',
        },
      });

      return reply.code(201).send({ comment });
    },
  );
}
