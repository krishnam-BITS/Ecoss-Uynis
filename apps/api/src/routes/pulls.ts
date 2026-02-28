import type { FastifyInstance } from 'fastify';
import {
  getRepoAccess,
  hasRequiredRole,
  isPublicReadable,
  Prisma,
  prisma,
} from '@uynis/db';
import { z } from 'zod';
import { getRepoDir } from '../lib/git-info.js';
import {
  branchExists,
  compareBranches,
  getBranchHeadSha,
  mergeBranches,
  normalizeRepoPath,
  readComparePatch,
  validateBranchName,
} from '../lib/git-engine.js';
import { selectBranchRule } from '../lib/branch-rules.js';
import { requireRepoAccess } from '../lib/repo-access.js';
import { ensureRepoLabels, toLabelKey } from '../lib/repo-labels.js';
import { findOwnersForPath, loadCodeowners } from '../lib/codeowners.js';
import {
  createMentionNotifications,
  createNotificationFanout,
} from '../lib/notifications.js';
import { runTaskWorkflowsForEvent } from '../lib/task-workflows.js';
import { indexPullById, searchPullIds } from '../lib/opensearch.js';
import { enqueueRepoWebhookEvent } from '../lib/repo-webhooks.js';

const assigneeIdsSchema = z.array(z.string().min(1)).max(20);
const labelNamesSchema = z.array(z.string().min(1).max(40)).max(20);

const createPullSchema = z.object({
  title: z.string().min(2),
  body: z.string().optional(),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1).optional(),
  assigneeIds: assigneeIdsSchema.optional(),
  labels: labelNamesSchema.optional(),
});

const updatePullSchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
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

const pullQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
  assigneeId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
});

const createPullCommentSchema = z.object({
  body: z.string().min(1).max(10000),
});

const createPullReviewCommentSchema = z.object({
  path: z.string().min(1),
  line: z.coerce.number().int().min(1).optional(),
  body: z.string().min(1).max(10000),
});

const setPullReviewSchema = z.object({
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED']),
  body: z.string().max(10000).optional(),
});

const setPullCheckSchema = z.object({
  context: z.string().min(1).max(120),
  status: z.enum(['QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE']),
  details: z.string().max(1000).optional(),
});

const pullDiffFileQuerySchema = z.object({
  path: z.string().min(1),
});

const pullReviewCommentQuerySchema = z.object({
  path: z.string().min(1).optional(),
});

const setPullReviewRequestSchema = z.object({
  reviewerId: z.string().min(1),
});

function normalizeCheckContext(value: string): string {
  return value.trim();
}

function resolveOwnerIdentity(owner: string): { type: 'username' | 'email' | 'unknown'; value: string } {
  const trimmed = owner.trim();
  if (!trimmed) {
    return { type: 'unknown', value: owner };
  }
  if (trimmed.startsWith('@')) {
    const username = trimmed.slice(1);
    if (!username || username.includes('/')) {
      return { type: 'unknown', value: owner };
    }
    return { type: 'username', value: username.toLowerCase() };
  }
  if (trimmed.includes('@')) {
    return { type: 'email', value: trimmed.toLowerCase() };
  }
  return { type: 'unknown', value: owner };
}

function scoreRecency(updatedAt: Date): number {
  const now = Date.now();
  const days = Math.max(0, (now - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 14) {
    return 3;
  }
  if (days <= 30) {
    return 2;
  }
  return 1;
}

const pullSelect = {
  id: true,
  title: true,
  status: true,
  sourceBranch: true,
  targetBranch: true,
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

function mapPull(pull: {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  sourceBranch: string;
  targetBranch: string;
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
    id: pull.id,
    title: pull.title,
    status: pull.status,
    sourceBranch: pull.sourceBranch,
    targetBranch: pull.targetBranch,
    createdAt: pull.createdAt,
    author: {
      id: pull.author.id,
      name: pull.author.name,
      email: pull.author.email ?? '',
      username: pull.author.username,
    },
    assignees: pull.assignees.map((entry) => ({
      id: entry.user.id,
      name: entry.user.name,
      email: entry.user.email ?? '',
      username: entry.user.username,
    })),
    labels: pull.labels.map((entry) => entry.label),
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

async function syncPullMetadata(
  tx: Prisma.TransactionClient,
  input: {
    pullId: string;
    repoId: string;
    assigneeIds?: string[] | null;
    labels?: string[] | undefined;
  },
) {
  if (input.assigneeIds !== null && input.assigneeIds !== undefined) {
    await tx.pullRequestAssignee.deleteMany({
      where: { pullRequestId: input.pullId },
    });
    if (input.assigneeIds.length) {
      await tx.pullRequestAssignee.createMany({
        data: input.assigneeIds.map((userId) => ({
          pullRequestId: input.pullId,
          userId,
        })),
        skipDuplicates: true,
      });
    }
  }

  if (input.labels !== undefined) {
    const labels = await ensureRepoLabels(tx, input.repoId, input.labels);
    await tx.pullRequestLabel.deleteMany({
      where: { pullRequestId: input.pullId },
    });
    if (labels.length) {
      await tx.pullRequestLabel.createMany({
        data: labels.map((label) => ({
          pullRequestId: input.pullId,
          labelId: label.id,
        })),
        skipDuplicates: true,
      });
    }
  }
}

export async function pullRoutes(server: FastifyInstance) {
  server.get(
    '/workspaces/:workspaceId/repos/:repoId/reviewer-suggestions',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

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

      const [workspaceMembers, repoMembers, reviews, pullComments, inlineComments, issueComments] =
        await Promise.all([
          prisma.workspaceMember.findMany({
            where: { workspaceId: resolvedWorkspaceId },
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  username: true,
                },
              },
            },
          }),
          prisma.repoMember.findMany({
            where: { repoId: resolvedRepoId },
            select: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  username: true,
                },
              },
            },
          }),
          prisma.pullRequestReview.findMany({
            where: { pullRequest: { repoId: resolvedRepoId } },
            select: {
              reviewerId: true,
              updatedAt: true,
            },
          }),
          prisma.pullRequestComment.findMany({
            where: { pullRequest: { repoId: resolvedRepoId } },
            select: {
              authorId: true,
              createdAt: true,
            },
          }),
          prisma.pullRequestReviewComment.findMany({
            where: { pullRequest: { repoId: resolvedRepoId } },
            select: {
              authorId: true,
              updatedAt: true,
            },
          }),
          prisma.issueComment.findMany({
            where: { issue: { repoId: resolvedRepoId } },
            select: {
              authorId: true,
              createdAt: true,
            },
          }),
        ]);

      const memberMap = new Map<
        string,
        {
          id: string;
          name?: string | null;
          email: string;
          username?: string | null;
        }
      >();
      for (const member of workspaceMembers) {
        memberMap.set(member.user.id, member.user);
      }
      for (const member of repoMembers) {
        memberMap.set(member.user.id, member.user);
      }

      const scores = new Map<string, number>();
      const activityByUser = new Map<
        string,
        {
          reviews: number;
          pullComments: number;
          inlineComments: number;
          issueComments: number;
          lastActivityAt: number;
        }
      >();
      const bump = (userId: string, value: number) => {
        scores.set(userId, (scores.get(userId) ?? 0) + value);
      };
      const trackActivity = (
        userId: string,
        key: 'reviews' | 'pullComments' | 'inlineComments' | 'issueComments',
        at: Date,
      ) => {
        const current = activityByUser.get(userId) ?? {
          reviews: 0,
          pullComments: 0,
          inlineComments: 0,
          issueComments: 0,
          lastActivityAt: 0,
        };
        current[key] += 1;
        current.lastActivityAt = Math.max(current.lastActivityAt, at.getTime());
        activityByUser.set(userId, current);
      };

      for (const review of reviews) {
        bump(review.reviewerId, 6 + scoreRecency(review.updatedAt));
        trackActivity(review.reviewerId, 'reviews', review.updatedAt);
      }
      for (const comment of pullComments) {
        bump(comment.authorId, 3 + scoreRecency(comment.createdAt));
        trackActivity(comment.authorId, 'pullComments', comment.createdAt);
      }
      for (const comment of inlineComments) {
        bump(comment.authorId, 4 + scoreRecency(comment.updatedAt));
        trackActivity(comment.authorId, 'inlineComments', comment.updatedAt);
      }
      for (const comment of issueComments) {
        bump(comment.authorId, 1 + scoreRecency(comment.createdAt));
        trackActivity(comment.authorId, 'issueComments', comment.createdAt);
      }

      const viewerId = accessResult.userId ?? request.user.sub;
      const suggestions = [...memberMap.values()]
        .filter((user) => user.id !== viewerId)
        .map((user) => {
          const score = scores.get(user.id) ?? 0;
          const activity = activityByUser.get(user.id);
          const reasonParts: string[] = [];
          if (activity?.reviews) {
            reasonParts.push(`${activity.reviews} reviews`);
          }
          if (activity?.inlineComments) {
            reasonParts.push(`${activity.inlineComments} inline comments`);
          }
          if (activity?.pullComments) {
            reasonParts.push(`${activity.pullComments} pull comments`);
          }
          if (activity?.issueComments) {
            reasonParts.push(`${activity.issueComments} issue comments`);
          }
          return {
            user,
            score,
            reason:
              reasonParts.join(', ') || 'No recent review activity in this repository',
            lastActivityAt: activity?.lastActivityAt
              ? new Date(activity.lastActivityAt).toISOString()
              : null,
          };
        })
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          const leftName = (
            left.user.name ??
            left.user.username ??
            left.user.email
          ).toLowerCase();
          const rightName = (
            right.user.name ??
            right.user.username ??
            right.user.email
          ).toLowerCase();
          return leftName.localeCompare(rightName);
        });

      return reply.send({ suggestions });
    },
  );

  server.get('/workspaces/:workspaceId/repos/:repoId/pulls', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = pullQuerySchema.parse(request.query);

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
      ? await searchPullIds({
          q: search,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          limit: 200,
        })
      : null;
    if (search && searchResult?.usedOpenSearch && !searchResult.ids.length) {
      return { pulls: [] };
    }
    const pulls = await prisma.pullRequest.findMany({
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
                sourceBranch: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                targetBranch: {
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
      select: pullSelect,
    });

    const orderedPulls =
      searchResult?.usedOpenSearch && searchResult.ids.length
        ? orderBySearchIds(pulls, searchResult.ids)
        : pulls;

    return { pulls: orderedPulls.map(mapPull) };
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/pulls', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = createPullSchema.parse(request.body);

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

    const repo = accessResult.access.repo;
    const sourceBranch = body.sourceBranch.trim();
    const targetBranch = (body.targetBranch ?? repo.defaultBranch).trim();

    if (!sourceBranch || !targetBranch) {
      return reply
        .code(400)
        .send({ message: 'Source and target branches are required.' });
    }

    if (sourceBranch === targetBranch) {
      return reply.code(400).send({
        message: 'Source and target branch must be different.',
      });
    }

    try {
      await Promise.all([
        validateBranchName(sourceBranch),
        validateBranchName(targetBranch),
      ]);
    } catch {
      return reply.code(400).send({ message: 'Invalid branch name.' });
    }

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);

    const [sourceExists, targetExists] = await Promise.all([
      branchExists(repoDir, sourceBranch),
      branchExists(repoDir, targetBranch),
    ]);

    if (!sourceExists) {
      return reply.code(400).send({ message: 'Source branch does not exist.' });
    }
    if (!targetExists) {
      return reply.code(400).send({ message: 'Target branch does not exist.' });
    }

    const duplicatePull = await prisma.pullRequest.findFirst({
      where: {
        repoId: resolvedRepoId,
        sourceBranch,
        targetBranch,
        status: 'OPEN',
      },
      select: { id: true },
    });
    if (duplicatePull) {
      return reply
        .code(409)
        .send({ message: 'An open pull request for these branches already exists.' });
    }

    const branchRules = await prisma.branchRule.findMany({
      where: { repoId: resolvedRepoId },
      select: {
        id: true,
        pattern: true,
        requirePr: true,
        requireCodeOwners: true,
        requireApprovals: true,
        blockDirectPush: true,
        requiredChecks: true,
        updatedAt: true,
      },
    });
    const targetRule = selectBranchRule(branchRules, targetBranch);
    const requiredChecks = targetRule?.requirePr
      ? targetRule.requiredChecks
      : [];

    const pull = await prisma.$transaction(async (tx) => {
      const created = await tx.pullRequest.create({
        data: {
          repoId: resolvedRepoId,
          authorId: accessResult.userId ?? request.user.sub,
          title: body.title,
          body: body.body,
          sourceBranch,
          targetBranch,
        },
        select: {
          id: true,
          title: true,
        },
      });

      if (requiredChecks.length > 0) {
        await tx.pullRequestCheck.createMany({
          data: requiredChecks.map((context) => ({
            pullRequestId: created.id,
            context,
            status: 'QUEUED',
          })),
          skipDuplicates: true,
        });
      }

      if (assigneeIds.length) {
        await tx.pullRequestAssignee.createMany({
          data: assigneeIds.map((userId) => ({
            pullRequestId: created.id,
            userId,
          })),
          skipDuplicates: true,
        });
      }

      const labels = await ensureRepoLabels(tx, resolvedRepoId, body.labels ?? []);
      if (labels.length) {
        await tx.pullRequestLabel.createMany({
          data: labels.map((label) => ({
            pullRequestId: created.id,
            labelId: label.id,
          })),
          skipDuplicates: true,
        });
      }

      const fullPull = await tx.pullRequest.findUnique({
        where: { id: created.id },
        select: pullSelect,
      });
      if (!fullPull) {
        throw new Error('Pull request not found after creation.');
      }
      return fullPull;
    });

    await createMentionNotifications({
      texts: [body.title, body.body],
      actorId: accessResult.userId ?? request.user.sub,
      title: `Mentioned in pull request: ${pull.title}`,
      body: body.body ?? null,
      workspaceId: resolvedWorkspaceId,
      repoId: resolvedRepoId,
      pullRequestId: pull.id,
    });
    try {
      await runTaskWorkflowsForEvent({
        trigger: 'PULL_CREATED',
        actorId: accessResult.userId ?? request.user.sub,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
        message: `Pull request created: ${pull.title}`,
      });
    } catch (workflowError) {
      request.log.warn(
        { err: workflowError, pullRequestId: pull.id },
        'Unable to record task workflow run for pull request creation.',
      );
    }
    await indexPullById(pull.id);
    await enqueueRepoWebhookEvent({
      repoId: resolvedRepoId,
      eventType: 'PULL_OPENED',
      payload: {
        requestId: request.id,
        actorId: accessResult.userId ?? request.user?.sub ?? null,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
        title: pull.title,
        sourceBranch: pull.sourceBranch,
        targetBranch: pull.targetBranch,
      },
    });

    return reply.code(201).send({ pull: mapPull(pull) });
  });

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = updatePullSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          authorId: true,
          title: true,
          status: true,
          sourceBranch: true,
          targetBranch: true,
        },
      });

      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
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
      const hasMetadataUpdates =
        assigneeIds !== null || body.labels !== undefined;

      if (body.status === pull.status && !hasMetadataUpdates) {
        const existingPull = await prisma.pullRequest.findUnique({
          where: { id: pull.id },
          select: pullSelect,
        });
        if (!existingPull) {
          return reply.code(404).send({ message: 'Pull request not found.' });
        }
        return reply.send({
          pull: {
            ...mapPull(existingPull),
            mergeCommitSha: null,
          },
        });
      }

      if (
        body.status !== undefined &&
        pull.status === 'MERGED' &&
        body.status !== 'MERGED'
      ) {
        return reply
          .code(409)
          .send({ message: 'Merged pull requests cannot be reopened or closed.' });
      }

      if (body.status === 'MERGED') {
        if (pull.status !== 'OPEN') {
          return reply
            .code(409)
            .send({ message: 'Only open pull requests can be merged.' });
        }

        const repo = accessResult.access.repo;
        const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
        const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);

        const rules = await prisma.branchRule.findMany({
          where: { repoId: resolvedRepoId },
          select: {
            id: true,
            pattern: true,
            requirePr: true,
            requireCodeOwners: true,
            requireApprovals: true,
            blockDirectPush: true,
            requiredChecks: true,
            updatedAt: true,
          },
        });
        const targetRule = selectBranchRule(rules, pull.targetBranch);
        const requiredApprovals = targetRule?.requirePr
          ? Math.max(0, targetRule.requireApprovals)
          : 0;
        const requiredChecks = targetRule?.requirePr
          ? targetRule.requiredChecks
          : [];

        if (requiredApprovals > 0) {
          const [approvalCount, changesRequestedCount] = await Promise.all([
            prisma.pullRequestReview.count({
              where: {
                pullRequestId: pull.id,
                state: 'APPROVED',
                reviewerId: { not: pull.authorId },
              },
            }),
            prisma.pullRequestReview.count({
              where: {
                pullRequestId: pull.id,
                state: 'CHANGES_REQUESTED',
                reviewerId: { not: pull.authorId },
              },
            }),
          ]);

          if (changesRequestedCount > 0) {
            return reply.code(409).send({
              message:
                'Cannot merge while review state has requested changes.',
            });
          }

          if (approvalCount < requiredApprovals) {
            return reply.code(409).send({
              message: `Merge blocked by branch protection: ${requiredApprovals} approval(s) required, ${approvalCount} received.`,
            });
          }
        }

        if (requiredChecks.length > 0) {
          const checks = await prisma.pullRequestCheck.findMany({
            where: { pullRequestId: pull.id },
            select: {
              context: true,
              status: true,
            },
          });
          const checksByContext = new Map(
            checks.map((check) => [check.context.toLowerCase(), check.status]),
          );

          const headSha = await getBranchHeadSha(repoDir, pull.sourceBranch);
          const commitChecks = headSha
            ? await prisma.commitCheck.findMany({
                where: {
                  repoId: resolvedRepoId,
                  commitSha: headSha,
                  context: { in: requiredChecks },
                },
                select: {
                  context: true,
                  status: true,
                },
              })
            : [];
          const commitChecksByContext = new Map(
            commitChecks.map((check) => [check.context.toLowerCase(), check.status]),
          );

          const missing = requiredChecks.filter((context) => {
            const key = context.toLowerCase();
            const prStatus = checksByContext.get(key);
            if (prStatus === 'SUCCESS') {
              return false;
            }
            const commitStatus = commitChecksByContext.get(key);
            return commitStatus !== 'SUCCESS';
          });
          if (missing.length > 0) {
            return reply.code(409).send({
              message: `Merge blocked by required checks: ${missing.join(', ')}.`,
            });
          }
        }

        if (targetRule?.requireCodeOwners) {
          const comparison = await compareBranches(
            repoDir,
            pull.targetBranch,
            pull.sourceBranch,
          );
          const changedPaths = comparison.files.map((file) => file.path);

          if (changedPaths.length) {
            const codeowners = await loadCodeowners(repoDir, pull.targetBranch);
            if (!codeowners || !codeowners.rules.length) {
              return reply.code(409).send({
                message:
                  'Merge blocked: CODEOWNERS file is required for this branch.',
              });
            }

            const fileOwners = changedPaths
              .map((path) => ({
                path,
                owners: findOwnersForPath(codeowners.rules, path),
              }))
              .filter((entry) => entry.owners.length > 0);

            if (fileOwners.length) {
              const ownerTokens = new Set<string>();
              for (const entry of fileOwners) {
                entry.owners.forEach((owner) => ownerTokens.add(owner));
              }

              const usernames: string[] = [];
              const emails: string[] = [];
              for (const token of ownerTokens) {
                const resolved = resolveOwnerIdentity(token);
                if (resolved.type === 'username') {
                  usernames.push(resolved.value);
                } else if (resolved.type === 'email') {
                  emails.push(resolved.value);
                }
              }

              const owners = usernames.length || emails.length
                ? await prisma.user.findMany({
                    where: {
                      OR: [
                        usernames.length
                          ? { username: { in: usernames } }
                          : undefined,
                        emails.length ? { email: { in: emails } } : undefined,
                      ].filter(Boolean) as Array<Record<string, unknown>>,
                    },
                    select: { id: true, username: true, email: true },
                  })
                : [];

              const ownerIdsByUsername = new Map(
                owners
                  .filter((owner) => owner.username)
                  .map((owner) => [owner.username!.toLowerCase(), owner.id]),
              );
              const ownerIdsByEmail = new Map(
                owners
                  .filter((owner) => owner.email)
                  .map((owner) => [owner.email!.toLowerCase(), owner.id]),
              );

              const approvals = await prisma.pullRequestReview.findMany({
                where: {
                  pullRequestId: pull.id,
                  state: 'APPROVED',
                  reviewerId: { not: pull.authorId },
                },
                select: {
                  reviewerId: true,
                },
              });
              const approvedIds = new Set(
                approvals.map((entry) => entry.reviewerId),
              );

              const missingFiles: string[] = [];
              for (const entry of fileOwners) {
                const resolvedIds = entry.owners
                  .map((owner) => {
                    const resolved = resolveOwnerIdentity(owner);
                    if (resolved.type === 'username') {
                      return ownerIdsByUsername.get(resolved.value) ?? null;
                    }
                    if (resolved.type === 'email') {
                      return ownerIdsByEmail.get(resolved.value) ?? null;
                    }
                    return null;
                  })
                  .filter((value): value is string => Boolean(value));

                if (!resolvedIds.length) {
                  missingFiles.push(entry.path);
                  continue;
                }
                const hasApproval = resolvedIds.some((id) =>
                  approvedIds.has(id),
                );
                if (!hasApproval) {
                  missingFiles.push(entry.path);
                }
              }

              if (missingFiles.length) {
                const preview = missingFiles.slice(0, 3).join(', ');
                const suffix =
                  missingFiles.length > 3 ? `, and ${missingFiles.length - 3} more` : '';
                return reply.code(409).send({
                  message: `Merge blocked by code owner review. Missing approval for ${missingFiles.length} file(s): ${preview}${suffix}.`,
                });
              }
            }
          }
        }

        const actor = await prisma.user.findUnique({
          where: { id: accessResult.userId ?? request.user.sub },
          select: { name: true, email: true, username: true },
        });

        const mergeAuthorName =
          actor?.name?.trim() || actor?.username?.trim() || 'Uynis User';
        const mergeAuthorEmail =
          actor?.email?.trim() || 'noreply@uynis.local';

        let mergeCommitSha: string;
        try {
          const mergeResult = await mergeBranches({
            repoDir,
            sourceBranch: pull.sourceBranch,
            targetBranch: pull.targetBranch,
            authorName: mergeAuthorName,
            authorEmail: mergeAuthorEmail,
            message: `Merge pull request ${pull.id.slice(0, 8)}: ${pull.title}`,
          });
          mergeCommitSha = mergeResult.sha;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to merge pull request.';
          const lowered = message.toLowerCase();
          const statusCode =
            lowered.includes('conflict') || lowered.includes('does not exist')
              ? 409
              : 400;
          return reply.code(statusCode).send({ message });
        }

        const updated = await prisma.$transaction(async (tx) => {
          await tx.pullRequest.update({
            where: { id: pullId },
            data: { status: 'MERGED' },
          });
          await syncPullMetadata(tx, {
            pullId,
            repoId: resolvedRepoId,
            assigneeIds,
            labels: body.labels,
          });

          const fullPull = await tx.pullRequest.findUnique({
            where: { id: pullId },
            select: pullSelect,
          });
          if (!fullPull) {
            throw new Error('Pull request not found after merge.');
          }
          return fullPull;
        });

        const actorId = accessResult.userId ?? request.user.sub;
        const [reviewers, requestedReviewers, commenters, inlineCommenters] =
          await Promise.all([
            prisma.pullRequestReview.findMany({
              where: { pullRequestId: pullId },
              select: { reviewerId: true },
              distinct: ['reviewerId'],
            }),
            prisma.pullRequestReviewRequest.findMany({
              where: { pullRequestId: pullId },
              select: { reviewerId: true },
              distinct: ['reviewerId'],
            }),
            prisma.pullRequestComment.findMany({
              where: { pullRequestId: pullId },
              select: { authorId: true },
              distinct: ['authorId'],
            }),
            prisma.pullRequestReviewComment.findMany({
              where: { pullRequestId: pullId },
              select: { authorId: true },
              distinct: ['authorId'],
            }),
          ]);
        await createNotificationFanout({
          recipientIds: [
            pull.authorId,
            ...reviewers.map((entry) => entry.reviewerId),
            ...requestedReviewers.map((entry) => entry.reviewerId),
            ...commenters.map((entry) => entry.authorId),
            ...inlineCommenters.map((entry) => entry.authorId),
          ],
          actorId,
          type: 'PULL_STATUS',
          title: `Pull request merged: ${pull.title}`,
          body: `${pull.sourceBranch} -> ${pull.targetBranch}`,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          pullRequestId: pull.id,
        });
        try {
          await runTaskWorkflowsForEvent({
            trigger: 'PULL_MERGED',
            actorId,
            workspaceId: resolvedWorkspaceId,
            repoId: resolvedRepoId,
            pullRequestId: pull.id,
            message: `Pull request merged: ${pull.title}`,
          });
        } catch (workflowError) {
          request.log.warn(
            { err: workflowError, pullRequestId: pull.id },
            'Unable to record task workflow run for pull request merge.',
          );
        }
        await indexPullById(updated.id);

        return reply.send({
          pull: {
            ...mapPull(updated),
            mergeCommitSha,
          },
        });
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (body.status !== undefined) {
          await tx.pullRequest.update({
            where: { id: pullId },
            data: { status: body.status },
          });
        }
        await syncPullMetadata(tx, {
          pullId,
          repoId: resolvedRepoId,
          assigneeIds,
          labels: body.labels,
        });

        const fullPull = await tx.pullRequest.findUnique({
          where: { id: pullId },
          select: pullSelect,
        });
        if (!fullPull) {
          throw new Error('Pull request not found after update.');
        }
        return fullPull;
      });

      if (body.status !== undefined) {
        await createNotificationFanout({
          recipientIds: [pull.authorId],
          actorId: accessResult.userId ?? request.user.sub,
          type: 'PULL_STATUS',
          title:
            body.status === 'OPEN'
              ? `Pull request reopened: ${pull.title}`
              : `Pull request closed: ${pull.title}`,
          body: `${pull.sourceBranch} -> ${pull.targetBranch}`,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          pullRequestId: pull.id,
        });
      }
      await indexPullById(updated.id);

      return reply.send({
        pull: {
          ...mapPull(updated),
          mergeCommitSha: null,
        },
      });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/reviews',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          authorId: true,
          targetBranch: true,
        },
      });


      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const [reviews, rules, checks] = await Promise.all([
        prisma.pullRequestReview.findMany({
          where: { pullRequestId: pullId },
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            state: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            reviewer: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true,
              },
            },
          },
        }),
        prisma.branchRule.findMany({
          where: { repoId: resolvedRepoId },
          select: {
            id: true,
            pattern: true,
            requirePr: true,
            requireCodeOwners: true,
            requireApprovals: true,
            blockDirectPush: true,
            requiredChecks: true,
            updatedAt: true,
          },
        }),
        prisma.pullRequestCheck.findMany({
          where: { pullRequestId: pullId },
          select: {
            context: true,
            status: true,
          },
        }),
      ]);

      const targetRule = selectBranchRule(rules, pull.targetBranch);
      const requiredApprovals = targetRule?.requirePr
        ? Math.max(0, targetRule.requireApprovals)
        : 0;
      const requiredChecks = targetRule?.requirePr
        ? targetRule.requiredChecks
        : [];
      const approvals = reviews.filter(
        (review) =>
          review.state === 'APPROVED' && review.reviewer.id !== pull.authorId,
      ).length;
      const changesRequested = reviews.filter(
        (review) =>
          review.state === 'CHANGES_REQUESTED' &&
          review.reviewer.id !== pull.authorId,
      ).length;
      const checksByContext = new Map(
        checks.map((check) => [check.context.toLowerCase(), check.status]),
      );
      const missingChecks = requiredChecks.filter((context) => {
        const status = checksByContext.get(context.toLowerCase());
        return status !== 'SUCCESS';
      });

      return reply.send({
        reviews,
        summary: {
          requiredApprovals,
          approvals,
          changesRequested,
          requiredChecks,
          missingChecks,
        },
      });
    },
  );

  server.put(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/reviews',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = setPullReviewSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          authorId: true,
          status: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }
      if (pull.status !== 'OPEN') {
        return reply
          .code(409)
          .send({ message: 'Reviews can only be updated on open pull requests.' });
      }

      const reviewerId = accessResult.userId ?? request.user.sub;
      if (reviewerId === pull.authorId && body.state === 'APPROVED') {
        return reply
          .code(409)
          .send({ message: 'Authors cannot approve their own pull request.' });
      }

      const review = await prisma.pullRequestReview.upsert({
        where: {
          pullRequestId_reviewerId: {
            pullRequestId: pullId,
            reviewerId,
          },
        },
        create: {
          pullRequestId: pullId,
          reviewerId,
          state: body.state,
          body: body.body?.trim() || null,
        },
        update: {
          state: body.state,
          body: body.body?.trim() || null,
        },
        select: {
          id: true,
          state: true,
          body: true,
          createdAt: true,
          updatedAt: true,
          reviewer: {
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
      await prisma.pullRequestReviewRequest.updateMany({
        where: {
          pullRequestId: pullId,
          reviewerId,
          fulfilledAt: null,
        },
        data: {
          fulfilledAt: new Date(),
        },
      });
      await createNotificationFanout({
        recipientIds: [pull.authorId],
        actorId,
        type: 'REVIEW_SUBMITTED',
        title: `${pull.title} - review ${body.state.replace('_', ' ').toLowerCase()}`,
        body: body.body?.trim() || null,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });
      await createMentionNotifications({
        texts: [body.body],
        actorId,
        title: 'Mentioned in pull request review',
        body: body.body?.trim() || null,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });

      return reply.send({ review });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/review-requests',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          authorId: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const reviewRequests = await prisma.pullRequestReviewRequest.findMany({
        where: {
          pullRequestId: pullId,
          fulfilledAt: null,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          reviewer: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
          requestedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
        },
      });

      return reply.send({ reviewRequests });
    },
  );

  server.put(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/review-requests',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = setPullReviewRequestSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          authorId: true,
          status: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }
      if (pull.status !== 'OPEN') {
        return reply
          .code(409)
          .send({ message: 'Review requests can only be updated on open pull requests.' });
      }

      const reviewerId = body.reviewerId.trim();
      if (!reviewerId) {
        return reply.code(400).send({ message: 'Reviewer is required.' });
      }
      if (reviewerId === pull.authorId) {
        return reply
          .code(409)
          .send({ message: 'Authors cannot be requested to review their own pull request.' });
      }

      const reviewerExists = await prisma.user.findUnique({
        where: { id: reviewerId },
        select: { id: true },
      });
      if (!reviewerExists) {
        return reply.code(404).send({ message: 'Reviewer not found.' });
      }

      const reviewerAccess = await getRepoAccess(reviewerId, resolvedRepoId);
      if (
        !reviewerAccess ||
        reviewerAccess.repo.workspaceId !== resolvedWorkspaceId
      ) {
        return reply.code(404).send({ message: 'Reviewer does not have repository access.' });
      }
      if (
        !hasRequiredRole(reviewerAccess.role, 'READ') &&
        !isPublicReadable(reviewerAccess)
      ) {
        return reply.code(409).send({
          message: 'Reviewer must have at least read access to this repository.',
        });
      }

      const actorId = accessResult.userId ?? request.user.sub;
      const reviewRequest = await prisma.pullRequestReviewRequest.upsert({
        where: {
          pullRequestId_reviewerId: {
            pullRequestId: pullId,
            reviewerId,
          },
        },
        create: {
          pullRequestId: pullId,
          reviewerId,
          requestedById: actorId,
          fulfilledAt: null,
        },
        update: {
          requestedById: actorId,
          fulfilledAt: null,
        },
        select: {
          id: true,
          createdAt: true,
          updatedAt: true,
          reviewer: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
          requestedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
            },
          },
        },
      });

      await createNotificationFanout({
        recipientIds: [reviewerId],
        actorId,
        type: 'REVIEW_REQUESTED',
        title: `Review requested: ${pull.title}`,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });

      return reply.send({ reviewRequest });
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/review-requests/:reviewerId',
    async (request, reply) => {
      const { workspaceId, repoId, pullId, reviewerId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
        reviewerId: string;
      };

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          status: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }
      if (pull.status !== 'OPEN') {
        return reply
          .code(409)
          .send({ message: 'Review requests can only be updated on open pull requests.' });
      }

      const removed = await prisma.pullRequestReviewRequest.deleteMany({
        where: {
          pullRequestId: pull.id,
          reviewerId,
        },
      });

      return reply.send({ ok: true, removed: removed.count });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/checks',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          sourceBranch: true,
          targetBranch: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const [checks, rules] = await Promise.all([
        prisma.pullRequestCheck.findMany({
          where: { pullRequestId: pullId },
          orderBy: [{ context: 'asc' }, { updatedAt: 'desc' }],
          select: {
            id: true,
            context: true,
            status: true,
            details: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.branchRule.findMany({
          where: { repoId: resolvedRepoId },
          select: {
            id: true,
            pattern: true,
            requirePr: true,
            requireCodeOwners: true,
            requireApprovals: true,
            blockDirectPush: true,
            requiredChecks: true,
            updatedAt: true,
          },
        }),
      ]);

      const targetRule = selectBranchRule(rules, pull.targetBranch);
      const requiredChecks = targetRule?.requirePr
        ? targetRule.requiredChecks
        : [];
      const checksByContext = new Map(
        checks.map((check) => [check.context.toLowerCase(), check.status]),
      );

      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
      const repoDir = await getRepoDir(repoRoot, accessResult.access.repo.workspace.slug, accessResult.access.repo.slug);
      const headSha = await getBranchHeadSha(repoDir, pull.sourceBranch);
      const commitChecks = headSha
        ? await prisma.commitCheck.findMany({
            where: {
              repoId: resolvedRepoId,
              commitSha: headSha,
              context: { in: requiredChecks },
            },
            select: {
              context: true,
              status: true,
            },
          })
        : [];
      const commitChecksByContext = new Map(
        commitChecks.map((check) => [check.context.toLowerCase(), check.status]),
      );

      const missingChecks = requiredChecks.filter((context) => {
        const key = context.toLowerCase();
        const prStatus = checksByContext.get(key);
        if (prStatus === 'SUCCESS') {
          return false;
        }
        const commitStatus = commitChecksByContext.get(key);
        return commitStatus !== 'SUCCESS';
      });

      return reply.send({
        checks,
        summary: {
          headCommitSha: headSha,
          requiredChecks,
          missingChecks,
          success: checks.filter((check) => check.status === 'SUCCESS').length,
          failed: checks.filter((check) => check.status === 'FAILURE').length,
          pending: checks.filter(
            (check) =>
              check.status === 'QUEUED' || check.status === 'IN_PROGRESS',
          ).length,
        },
      });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/timeline',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
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
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const [comments, reviews, checks, reviewComments, reviewRequests] =
        await Promise.all([
        prisma.pullRequestComment.findMany({
          where: { pullRequestId: pullId },
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
        }),
        prisma.pullRequestReview.findMany({
          where: { pullRequestId: pullId },
          select: {
            id: true,
            state: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            reviewer: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true,
              },
            },
          },
        }),
        prisma.pullRequestCheck.findMany({
          where: { pullRequestId: pullId },
          select: {
            id: true,
            context: true,
            status: true,
            details: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.pullRequestReviewComment.findMany({
          where: { pullRequestId: pullId },
          select: {
            id: true,
            path: true,
            line: true,
            body: true,
            createdAt: true,
            updatedAt: true,
            author: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true,
              },
            },
          },
        }),
        prisma.pullRequestReviewRequest.findMany({
          where: {
            pullRequestId: pullId,
          },
          select: {
            id: true,
            reviewer: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true,
              },
            },
            requestedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true,
              },
            },
            createdAt: true,
            fulfilledAt: true,
          },
        }),
      ]);

      const events: Array<{
        id: string;
        type:
          | 'OPENED'
          | 'COMMENTED'
          | 'REVIEW_REQUESTED'
          | 'REVIEWED'
          | 'CHECK_UPDATED'
          | 'STATUS';
        createdAt: Date;
        actor?: {
          id: string;
          name?: string | null;
          email: string;
          username?: string | null;
        };
        title: string;
        body?: string | null;
      }> = [];

      events.push({
        id: `opened:${pull.id}`,
        type: 'OPENED',
        createdAt: pull.createdAt,
        actor: pull.author,
        title: 'Pull request opened',
        body: pull.title,
      });

      for (const comment of comments) {
        events.push({
          id: `comment:${comment.id}`,
          type: 'COMMENTED',
          createdAt: comment.createdAt,
          actor: comment.author,
          title: 'Comment added',
          body: comment.body,
        });
      }

      for (const review of reviews) {
        events.push({
          id: `review:${review.id}`,
          type: 'REVIEWED',
          createdAt: review.updatedAt,
          actor: review.reviewer,
          title: `Review: ${review.state.replace('_', ' ')}`,
          body: review.body,
        });
      }

      for (const requestEntry of reviewRequests) {
        events.push({
          id: `review-request:${requestEntry.id}`,
          type: 'REVIEW_REQUESTED',
          createdAt: requestEntry.createdAt,
          actor: requestEntry.requestedBy,
          title: `Review requested from ${
            requestEntry.reviewer.name ??
            requestEntry.reviewer.username ??
            requestEntry.reviewer.email
          }`,
          body: requestEntry.fulfilledAt ? 'Completed' : null,
        });
      }

      for (const check of checks) {
        events.push({
          id: `check:${check.id}`,
          type: 'CHECK_UPDATED',
          createdAt: check.updatedAt,
          title: `Check ${check.context}: ${check.status}`,
          body: check.details,
        });
      }

      for (const comment of reviewComments) {
        events.push({
          id: `inline-comment:${comment.id}`,
          type: 'COMMENTED',
          createdAt: comment.updatedAt,
          actor: comment.author,
          title: `Inline comment on ${comment.path}${
            comment.line ? `:${comment.line}` : ''
          }`,
          body: comment.body,
        });
      }

      if (pull.status !== 'OPEN') {
        events.push({
          id: `status:${pull.id}:${pull.status}`,
          type: 'STATUS',
          createdAt: pull.updatedAt,
          actor: pull.author,
          title:
            pull.status === 'MERGED'
              ? 'Pull request merged'
              : 'Pull request closed',
        });
      }

      events.sort((left, right) => {
        const delta = left.createdAt.getTime() - right.createdAt.getTime();
        if (delta !== 0) {
          return delta;
        }
        return left.id.localeCompare(right.id);
      });

      return reply.send({ events });
    },
  );

  server.put(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/checks',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = setPullCheckSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          status: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      if (pull.status === 'MERGED') {
        return reply
          .code(409)
          .send({ message: 'Checks cannot be updated after merge.' });
      }

      const context = normalizeCheckContext(body.context);
      if (!context) {
        return reply.code(400).send({ message: 'Check context is required.' });
      }

      const check = await prisma.pullRequestCheck.upsert({
        where: {
          pullRequestId_context: {
            pullRequestId: pullId,
            context,
          },
        },
        create: {
          pullRequestId: pullId,
          context,
          status: body.status,
          details: body.details?.trim() || null,
        },
        update: {
          status: body.status,
          details: body.details?.trim() || null,
        },
        select: {
          id: true,
          context: true,
          status: true,
          details: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ check });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/diff',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          title: true,
          authorId: true,
          sourceBranch: true,
          targetBranch: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const repo = accessResult.access.repo;
      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

      try {
        const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
        const diff = await compareBranches(
          repoDir,
          pull.targetBranch,
          pull.sourceBranch,
        );
        return reply.send({ diff });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to compare branches.';
        if (message.toLowerCase().includes('does not exist')) {
          return reply.code(409).send({ message });
        }
        return reply.code(500).send({ message: 'Unable to compare branches.' });
      }
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/diff/file',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const query = pullDiffFileQuerySchema.parse(request.query);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          sourceBranch: true,
          targetBranch: true,
        },
      });
      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const repo = accessResult.access.repo;
      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

      try {
        const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
        const patch = await readComparePatch({
          repoDir,
          baseBranch: pull.targetBranch,
          headBranch: pull.sourceBranch,
          filePath: query.path,
        });
        return reply.send({ patch });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to load file diff.';
        if (
          message === 'Invalid path.' ||
          message.toLowerCase().includes('does not exist')
        ) {
          return reply.code(400).send({ message });
        }
        return reply.code(500).send({ message: 'Unable to load file diff.' });
      }
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/review-comments',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const query = pullReviewCommentQuerySchema.parse(request.query);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: {
          id: true,
          sourceBranch: true,
          targetBranch: true,
        },
      });

      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      let filteredPath: string | undefined;
      try {
        filteredPath = query.path ? normalizeRepoPath(query.path) : undefined;
      } catch {
        return reply.code(400).send({ message: 'Invalid path.' });
      }

      const comments = await prisma.pullRequestReviewComment.findMany({
        where: {
          pullRequestId: pullId,
          path: filteredPath,
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          path: true,
          line: true,
          body: true,
          createdAt: true,
          updatedAt: true,
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
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/review-comments',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = createPullReviewCommentSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: { id: true },
      });

      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      let commentPath: string;
      try {
        commentPath = normalizeRepoPath(body.path);
      } catch {
        return reply.code(400).send({ message: 'Invalid path.' });
      }
      if (!commentPath) {
        return reply.code(400).send({ message: 'Path is required.' });
      }

      const repo = accessResult.access.repo;
      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
      try {
        const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
        const diff = await compareBranches({
          repoDir,
          baseBranch: pull.targetBranch,
          headBranch: pull.sourceBranch,
        });
        const pathInPull = diff.files.some(
          (file) => file.path === commentPath || file.previousPath === commentPath,
        );
        if (!pathInPull) {
          return reply
            .code(400)
            .send({ message: 'Inline comments must target a changed file.' });
        }
      } catch {
        return reply
          .code(500)
          .send({ message: 'Unable to validate inline comment path.' });
      }

      const comment = await prisma.pullRequestReviewComment.create({
        data: {
          pullRequestId: pullId,
          authorId: accessResult.userId ?? request.user.sub,
          path: commentPath,
          line: body.line ?? null,
          body: body.body,
        },
        select: {
          id: true,
          path: true,
          line: true,
          body: true,
          createdAt: true,
          updatedAt: true,
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
      const [reviewers, requestedReviewers, topLevelCommenters, inlineCommenters] =
        await Promise.all([
          prisma.pullRequestReview.findMany({
            where: { pullRequestId: pullId },
            select: { reviewerId: true },
            distinct: ['reviewerId'],
          }),
          prisma.pullRequestReviewRequest.findMany({
            where: { pullRequestId: pullId, fulfilledAt: null },
            select: { reviewerId: true },
            distinct: ['reviewerId'],
          }),
          prisma.pullRequestComment.findMany({
            where: { pullRequestId: pullId },
            select: { authorId: true },
            distinct: ['authorId'],
          }),
          prisma.pullRequestReviewComment.findMany({
            where: { pullRequestId: pullId },
            select: { authorId: true },
            distinct: ['authorId'],
          }),
        ]);
      await createNotificationFanout({
        recipientIds: [
          pull.authorId,
          ...reviewers.map((entry) => entry.reviewerId),
          ...requestedReviewers.map((entry) => entry.reviewerId),
          ...topLevelCommenters.map((entry) => entry.authorId),
          ...inlineCommenters.map((entry) => entry.authorId),
        ],
        actorId,
        type: 'PULL_COMMENT',
        title: `Inline comment on ${pull.title}`,
        body: `${comment.path}${comment.line ? `:${comment.line}` : ''} - ${comment.body}`,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });
      await createMentionNotifications({
        texts: [comment.body],
        actorId,
        title: `Mentioned in inline comment: ${pull.title}`,
        body: comment.body,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });
      await enqueueRepoWebhookEvent({
        repoId: resolvedRepoId,
        eventType: 'COMMENT_ADDED',
        payload: {
          requestId: request.id,
          actorId,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          pullRequestId: pull.id,
          commentId: comment.id,
          commentBody: comment.body,
          target: 'pull-inline-comment',
          path: comment.path,
          line: comment.line,
        },
      });

      return reply.code(201).send({ comment });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/comments',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: { id: true, title: true, authorId: true },
      });

      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const comments = await prisma.pullRequestComment.findMany({
        where: { pullRequestId: pullId },
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
    '/workspaces/:workspaceId/repos/:repoId/pulls/:pullId/comments',
    async (request, reply) => {
      const { workspaceId, repoId, pullId } = request.params as {
        workspaceId: string;
        repoId: string;
        pullId: string;
      };
      const body = createPullCommentSchema.parse(request.body);

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

      const pull = await prisma.pullRequest.findFirst({
        where: {
          id: pullId,
          repoId: resolvedRepoId,
          repo: { workspaceId: resolvedWorkspaceId },
        },
        select: { id: true },
      });

      if (!pull) {
        return reply.code(404).send({ message: 'Pull request not found.' });
      }

      const comment = await prisma.pullRequestComment.create({
        data: {
          pullRequestId: pullId,
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
      const [reviewers, requestedReviewers, topLevelCommenters, inlineCommenters] =
        await Promise.all([
          prisma.pullRequestReview.findMany({
            where: { pullRequestId: pullId },
            select: { reviewerId: true },
            distinct: ['reviewerId'],
          }),
          prisma.pullRequestReviewRequest.findMany({
            where: { pullRequestId: pullId, fulfilledAt: null },
            select: { reviewerId: true },
            distinct: ['reviewerId'],
          }),
          prisma.pullRequestComment.findMany({
            where: { pullRequestId: pullId },
            select: { authorId: true },
            distinct: ['authorId'],
          }),
          prisma.pullRequestReviewComment.findMany({
            where: { pullRequestId: pullId },
            select: { authorId: true },
            distinct: ['authorId'],
          }),
        ]);
      await createNotificationFanout({
        recipientIds: [
          pull.authorId,
          ...reviewers.map((entry) => entry.reviewerId),
          ...requestedReviewers.map((entry) => entry.reviewerId),
          ...topLevelCommenters.map((entry) => entry.authorId),
          ...inlineCommenters.map((entry) => entry.authorId),
        ],
        actorId,
        type: 'PULL_COMMENT',
        title: `New comment on pull request: ${pull.title}`,
        body: comment.body,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });
      await createMentionNotifications({
        texts: [comment.body],
        actorId,
        title: `Mentioned in pull request comment: ${pull.title}`,
        body: comment.body,
        workspaceId: resolvedWorkspaceId,
        repoId: resolvedRepoId,
        pullRequestId: pull.id,
      });
      await enqueueRepoWebhookEvent({
        repoId: resolvedRepoId,
        eventType: 'COMMENT_ADDED',
        payload: {
          requestId: request.id,
          actorId,
          workspaceId: resolvedWorkspaceId,
          repoId: resolvedRepoId,
          pullRequestId: pull.id,
          commentId: comment.id,
          commentBody: comment.body,
          target: 'pull-comment',
        },
      });

      return reply.code(201).send({ comment });
    },
  );
}
