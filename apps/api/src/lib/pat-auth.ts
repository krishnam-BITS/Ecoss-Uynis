import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  findPersonalAccessToken,
  isPersonalAccessToken,
  isTokenActive,
  touchPersonalAccessToken,
  type PersonalAccessTokenRecord,
} from './pats.js';
import { buildRateLimitKey, enforceRateLimit } from './rate-limit.js';

const PAT_AUTH_ATTEMPT_LIMIT = Number.parseInt(
  process.env.PAT_AUTH_ATTEMPT_LIMIT ?? '120',
  10,
);
const PAT_AUTH_ATTEMPT_WINDOW_SECONDS = Number.parseInt(
  process.env.PAT_AUTH_ATTEMPT_WINDOW_SECONDS ?? '60',
  10,
);
const PAT_AUTH_FAILURE_LIMIT = Number.parseInt(
  process.env.PAT_AUTH_FAILURE_LIMIT ?? '24',
  10,
);
const PAT_AUTH_FAILURE_WINDOW_SECONDS = Number.parseInt(
  process.env.PAT_AUTH_FAILURE_WINDOW_SECONDS ?? '300',
  10,
);

type PersonalAccessTokenWithUser = PersonalAccessTokenRecord & {
  user: {
    id: string;
    email: string | null;
  };
};

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.startsWith('Basic ')) {
    return null;
  }
  const raw = value.slice(6);
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const [username = '', password = ''] = decoded.split(':');
    return { username, password };
  } catch {
    return null;
  }
}

function readAuthorizationToken(request: FastifyRequest) {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader) {
    return null;
  }

  if (authorizationHeader.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim() || null;
  }

  if (authorizationHeader.startsWith('Basic ')) {
    const decoded = decodeBasicAuth(authorizationHeader);
    if (!decoded) {
      return null;
    }
    if (isPersonalAccessToken(decoded.password)) {
      return decoded.password;
    }
    if (isPersonalAccessToken(decoded.username)) {
      return decoded.username;
    }
  }

  return null;
}

function toPatRequestContext(record: PersonalAccessTokenWithUser) {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
  };
}

function getPatRateLimitKey(kind: 'attempt' | 'failure', request: FastifyRequest) {
  const ip = request.ip?.trim() || 'unknown-ip';
  return buildRateLimitKey(['pat', 'auth', kind, ip]);
}

export function hasPatScope(
  scopes: string[],
  required: 'repo:read' | 'repo:write' | 'repo:admin' | 'platform:admin' | 'admin',
) {
  if (!scopes.length) {
    return false;
  }

  const hasLegacyAdmin = scopes.includes('admin');
  const hasPlatformAdmin = scopes.includes('platform:admin') || hasLegacyAdmin;
  const hasRepoAdmin = scopes.includes('repo:admin') || hasPlatformAdmin;
  const hasRepoWrite = scopes.includes('repo:write') || hasRepoAdmin;
  const hasRepoRead = scopes.includes('repo:read') || hasRepoWrite;

  if (required === 'repo:read') {
    return hasRepoRead;
  }
  if (required === 'repo:write') {
    return hasRepoWrite;
  }
  if (required === 'repo:admin') {
    return hasRepoAdmin;
  }
  if (required === 'platform:admin' || required === 'admin') {
    return hasPlatformAdmin;
  }

  return false;
}

export async function attachPersonalAccessTokenToRequest(input: {
  request: FastifyRequest;
  reply: FastifyReply;
}) {
  const { request, reply } = input;
  if (request.pat) {
    return true;
  }

  const token = readAuthorizationToken(request);
  if (!token || !isPersonalAccessToken(token)) {
    return true;
  }

  const attemptAllowed = await enforceRateLimit({
    request,
    reply,
    key: getPatRateLimitKey('attempt', request),
    limit: PAT_AUTH_ATTEMPT_LIMIT,
    windowSeconds: PAT_AUTH_ATTEMPT_WINDOW_SECONDS,
    message: 'Too many token authentication attempts. Try again shortly.',
  });
  if (!attemptAllowed) {
    return false;
  }

  const record = (await findPersonalAccessToken(token)) as PersonalAccessTokenWithUser | null;
  if (!record || !isTokenActive(record)) {
    const failureAllowed = await enforceRateLimit({
      request,
      reply,
      key: getPatRateLimitKey('failure', request),
      limit: PAT_AUTH_FAILURE_LIMIT,
      windowSeconds: PAT_AUTH_FAILURE_WINDOW_SECONDS,
      message: 'Too many failed token attempts. Try again later.',
    });
    if (!failureAllowed) {
      return false;
    }

    await reply.code(401).send({ message: 'Invalid authentication token.' });
    return false;
  }

  request.pat = toPatRequestContext(record);
  void touchPersonalAccessToken(record.id).catch(() => {
    // Best-effort token usage tracking.
  });
  return true;
}

export function getRequestActorId(request: FastifyRequest) {
  if (request.pat?.userId) {
    return request.pat.userId;
  }
  return request.user?.sub ?? null;
}
