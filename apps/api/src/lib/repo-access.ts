import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getRepoAccessByRef,
  hasRequiredRole,
  isPublicReadable,
  type RepoAccess,
  type RepoRole,
} from '@uynis/db';
import { getOptionalUserId } from './auth.js';
import { hasPatScope } from './pat-auth.js';

type RepoAccessResult = {
  access: RepoAccess;
  userId: string | null;
};

type RepoAccessParams = {
  workspaceId: string;
  repoId: string;
  requiredRole: RepoRole;
  requireAuth?: boolean;
};

export async function requireRepoAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  params: RepoAccessParams,
): Promise<RepoAccessResult | null> {
  const { workspaceId, repoId, requiredRole, requireAuth } = params;
  const userId = request.pat?.userId
    ? request.pat.userId
    : requireAuth
      ? (await request.jwtVerify(), request.user.sub)
      : await getOptionalUserId(request);

  if (request.pat) {
    const hasScope =
      requiredRole === 'READ'
        ? hasPatScope(request.pat.scopes, 'repo:read') ||
          hasPatScope(request.pat.scopes, 'repo:write')
        : requiredRole === 'WRITE'
          ? hasPatScope(request.pat.scopes, 'repo:write')
          : hasPatScope(request.pat.scopes, 'repo:admin');
    if (!hasScope) {
      await reply.code(403).send({ message: 'Token missing required scope.' });
      return null;
    }
  }

  const access = await getRepoAccessByRef(userId, workspaceId, repoId);
  if (!access) {
    await reply.code(404).send({ message: 'Repo not found.' });
    return null;
  }

  const canReadPublic =
    requiredRole === 'READ' &&
    (isPublicReadable(access) ||
      (Boolean(userId) && access.repo.visibility === 'PUBLIC'));
  if (!hasRequiredRole(access.role, requiredRole) && !canReadPublic) {
    const status = userId ? 403 : 401;
    const message = userId ? 'Forbidden.' : 'Authentication required.';
    await reply.code(status).send({ message });
    return null;
  }

  return { access, userId };
}

