import type { FastifyInstance } from 'fastify';
import { getRepoAccess, hasRequiredRole, isPublicReadable, prisma } from '@uynis/db';
import { z } from 'zod';
import {
  searchDiscussionThreadIds,
  searchIssueIds,
  searchPullIds,
} from '../lib/opensearch.js';
import { reindexRepoCodeById, searchRepoCode } from '../lib/code-search.js';

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(['issues', 'pulls', 'discussions']).default('issues'),
  workspaceId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const codeSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  repoId: z.string().min(1),
  branch: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const codeReindexBodySchema = z.object({
  repoId: z.string().min(1),
  branch: z.string().trim().min(1).optional(),
});

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

export async function searchRoutes(server: FastifyInstance) {
  server.get('/search/code', async (request, reply) => {
    await request.jwtVerify();
    const query = codeSearchQuerySchema.parse(request.query ?? {});

    const access = await getRepoAccess(request.user.sub, query.repoId);
    if (!access) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }
    const canRead =
      hasRequiredRole(access.role, 'READ') ||
      isPublicReadable(access) ||
      access.repo.visibility === 'PUBLIC';
    if (!canRead) {
      return reply.code(403).send({ message: 'Forbidden.' });
    }

    const result = await searchRepoCode({
      repoId: query.repoId,
      branch: query.branch,
      q: query.q,
      limit: query.limit,
    });

    return {
      type: 'code',
      source: result.source === 'opensearch' ? 'opensearch' : 'disabled',
      repoId: query.repoId,
      branch: query.branch ?? null,
      results: result.results,
    };
  });

  server.post('/internal/search/code/reindex', async (request, reply) => {
    const tokenHeader = request.headers['x-internal-token'];
    const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
    const expectedToken = process.env.INTERNAL_RPC_TOKEN?.trim() ?? '';
    if (!expectedToken || token?.trim() !== expectedToken) {
      return reply.code(401).send({ message: 'Unauthorized.' });
    }

    const body = codeReindexBodySchema.parse(request.body ?? {});
    void reindexRepoCodeById({
      repoId: body.repoId,
      branch: body.branch,
      requestId: request.id,
    }).catch((error) => {
      request.log.error(
        { err: error, repoId: body.repoId, branch: body.branch ?? null },
        'Code reindex request failed',
      );
    });

    return reply.code(202).send({
      accepted: true,
      repoId: body.repoId,
      branch: body.branch ?? null,
    });
  });

  server.get('/search', async (request) => {
    await request.jwtVerify();
    const query = searchQuerySchema.parse(request.query ?? {});
    const limit = query.limit ?? 30;

    if (query.type === 'issues') {
      const searchResult = await searchIssueIds({
        q: query.q,
        workspaceId: query.workspaceId,
        repoId: query.repoId,
        limit,
      });
      if (searchResult.usedOpenSearch && !searchResult.ids.length) {
        return { type: query.type, source: 'opensearch', results: [] };
      }

      const issues = await prisma.issue.findMany({
        where: {
          id:
            searchResult.usedOpenSearch && searchResult.ids.length
              ? { in: searchResult.ids }
              : undefined,
          repoId: query.repoId,
          repo: query.workspaceId
            ? {
                workspaceId: query.workspaceId,
              }
            : undefined,
          OR: searchResult.usedOpenSearch
            ? undefined
            : [
                { title: { contains: query.q, mode: 'insensitive' } },
                { body: { contains: query.q, mode: 'insensitive' } },
              ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          repoId: true,
          repo: {
            select: {
              workspaceId: true,
              name: true,
            },
          },
        },
      });

      const ordered =
        searchResult.usedOpenSearch && searchResult.ids.length
          ? orderBySearchIds(issues, searchResult.ids)
          : issues;

      return {
        type: query.type,
        source: searchResult.usedOpenSearch ? 'opensearch' : 'db-fallback',
        results: ordered.map((issue) => ({
          id: issue.id,
          title: issue.title,
          status: issue.status,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          repoId: issue.repoId,
          workspaceId: issue.repo.workspaceId,
          repoName: issue.repo.name,
        })),
      };
    }

    if (query.type === 'pulls') {
      const searchResult = await searchPullIds({
        q: query.q,
        workspaceId: query.workspaceId,
        repoId: query.repoId,
        limit,
      });
      if (searchResult.usedOpenSearch && !searchResult.ids.length) {
        return { type: query.type, source: 'opensearch', results: [] };
      }

      const pulls = await prisma.pullRequest.findMany({
        where: {
          id:
            searchResult.usedOpenSearch && searchResult.ids.length
              ? { in: searchResult.ids }
              : undefined,
          repoId: query.repoId,
          repo: query.workspaceId
            ? {
                workspaceId: query.workspaceId,
              }
            : undefined,
          OR: searchResult.usedOpenSearch
            ? undefined
            : [
                { title: { contains: query.q, mode: 'insensitive' } },
                { body: { contains: query.q, mode: 'insensitive' } },
                { sourceBranch: { contains: query.q, mode: 'insensitive' } },
                { targetBranch: { contains: query.q, mode: 'insensitive' } },
              ],
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          status: true,
          sourceBranch: true,
          targetBranch: true,
          createdAt: true,
          updatedAt: true,
          repoId: true,
          repo: {
            select: {
              workspaceId: true,
              name: true,
            },
          },
        },
      });

      const ordered =
        searchResult.usedOpenSearch && searchResult.ids.length
          ? orderBySearchIds(pulls, searchResult.ids)
          : pulls;

      return {
        type: query.type,
        source: searchResult.usedOpenSearch ? 'opensearch' : 'db-fallback',
        results: ordered.map((pull) => ({
          id: pull.id,
          title: pull.title,
          status: pull.status,
          sourceBranch: pull.sourceBranch,
          targetBranch: pull.targetBranch,
          createdAt: pull.createdAt,
          updatedAt: pull.updatedAt,
          repoId: pull.repoId,
          workspaceId: pull.repo.workspaceId,
          repoName: pull.repo.name,
        })),
      };
    }

    let workspaceNames: string[] | null = null;
    if (query.workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: query.workspaceId },
        select: { name: true, slug: true },
      });
      if (workspace) {
        workspaceNames = [workspace.name, workspace.slug];
      }
    }

    const searchResult = await searchDiscussionThreadIds({
      q: query.q,
      limit,
    });
    if (searchResult.usedOpenSearch && !searchResult.ids.length) {
      return { type: query.type, source: 'opensearch', results: [] };
    }

    const threads = await prisma.discussionThread.findMany({
      where: {
        id:
          searchResult.usedOpenSearch && searchResult.ids.length
            ? { in: searchResult.ids }
            : undefined,
        workspaceName: workspaceNames ? { in: workspaceNames } : undefined,
        OR: searchResult.usedOpenSearch
          ? undefined
          : [
              { title: { contains: query.q, mode: 'insensitive' } },
              { workspaceName: { contains: query.q, mode: 'insensitive' } },
              { repoName: { contains: query.q, mode: 'insensitive' } },
            ],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        category: true,
        replies: true,
        createdAt: true,
        updatedAt: true,
        workspaceName: true,
        repoName: true,
      },
    });

    const ordered =
      searchResult.usedOpenSearch && searchResult.ids.length
        ? orderBySearchIds(threads, searchResult.ids)
        : threads;

    return {
      type: query.type,
      source: searchResult.usedOpenSearch ? 'opensearch' : 'db-fallback',
      results: ordered,
    };
  });
}
