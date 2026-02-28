import type { FastifyInstance } from 'fastify';
import { prisma } from '@uynis/db';
import { z } from 'zod';
import {
  findRepoAutomationToken,
  isAutomationTokenActive,
  touchRepoAutomationToken,
} from '../lib/automation-tokens.js';

const hookCheckSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/i),
  context: z.string().min(1).max(120),
  status: z.enum(['QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE']),
  details: z.string().max(1000).optional(),
});

function hasScope(scopes: string[], required: string): boolean {
  if (!scopes.length) {
    return true;
  }
  return scopes.includes(required);
}

export async function hookRoutes(server: FastifyInstance) {
  server.post(
    '/hooks/repos/:workspaceSlug/:repoSlug/checks',
    async (request, reply) => {
      const tokenHeader = request.headers['x-uynis-hook-token'];
      const token =
        typeof tokenHeader === 'string'
          ? tokenHeader.trim()
          : Array.isArray(tokenHeader)
            ? tokenHeader[0]?.trim()
            : '';
      if (!token) {
        return reply.code(401).send({ message: 'Hook token is required.' });
      }

      const record = await findRepoAutomationToken(token);
      if (!record || !isAutomationTokenActive(record)) {
        return reply.code(401).send({ message: 'Invalid hook token.' });
      }

      if (!hasScope(record.scopes ?? [], 'checks:write')) {
        return reply
          .code(403)
          .send({ message: 'Hook token missing required scope: checks:write.' });
      }

      const { workspaceSlug, repoSlug } = request.params as {
        workspaceSlug: string;
        repoSlug: string;
      };
      if (
        record.repo.workspace.slug !== workspaceSlug ||
        record.repo.slug !== repoSlug
      ) {
        return reply.code(403).send({ message: 'Hook token not valid for repo.' });
      }

      const body = hookCheckSchema.parse(request.body ?? {});
      const commitSha = body.commitSha.toLowerCase();
      const context = body.context.trim();

      const check = await prisma.commitCheck.upsert({
        where: {
          repoId_commitSha_context: {
            repoId: record.repoId,
            commitSha,
            context,
          },
        },
        create: {
          repoId: record.repoId,
          commitSha,
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

      await touchRepoAutomationToken(record.id);

      return reply.send({ ok: true, commitSha, check });
    },
  );
}
