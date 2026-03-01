import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { spawn } from 'node:child_process';
import {
  getRepoAccessByRef,
  hasRequiredRole,
  isPublicReadable,
  prisma,
} from '@uynis/db';
import {
  getRepoDir,
  listCommits,
  listRepoTree,
  normalizeRepoPath,
  readRepoBlob,
} from './lib/git-read-engine.js';
import { verifyInternalRpcRequest } from './lib/internal-rpc-auth.js';
import {
  extractAuthTokenCandidate,
  findActivePersonalAccessToken,
  hasPatScope,
  isPersonalAccessToken,
  touchPersonalAccessToken,
  type GitPersonalAccessToken,
} from './lib/pat-auth.js';
import { checkRateLimit } from './lib/rate-limit.js';
import { enqueuePushWebhookDeliveries } from './lib/repo-webhooks.js';
import { getRedisClient } from './lib/redis.js';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL?.trim() || 'info',
    base: {
      service: 'git-storage',
    },
  },
  requestIdHeader: 'x-request-id',
});

const gitRequestContentTypePattern =
  /^application\/x-git-(upload|receive)-pack-request(?:;.*)?$/i;

server.addContentTypeParser(gitRequestContentTypePattern, (request, payload, done) => {
  // Keep Git pack payload as a stream for direct piping into git-http-backend.
  done(null, payload);
});
const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
const gitUploadPackRateLimit = Number.parseInt(
  process.env.GIT_UPLOAD_PACK_RATE_LIMIT ?? '240',
  10,
);
const gitUploadPackRateWindowSeconds = Number.parseInt(
  process.env.GIT_UPLOAD_PACK_RATE_WINDOW_SECONDS ?? '60',
  10,
);
const gitReceivePackRateLimit = Number.parseInt(
  process.env.GIT_RECEIVE_PACK_RATE_LIMIT ?? '120',
  10,
);
const gitReceivePackRateWindowSeconds = Number.parseInt(
  process.env.GIT_RECEIVE_PACK_RATE_WINDOW_SECONDS ?? '60',
  10,
);
const patAuthAttemptLimit = Number.parseInt(
  process.env.PAT_AUTH_ATTEMPT_LIMIT ?? '120',
  10,
);
const patAuthAttemptWindowSeconds = Number.parseInt(
  process.env.PAT_AUTH_ATTEMPT_WINDOW_SECONDS ?? '60',
  10,
);
const patAuthFailureLimit = Number.parseInt(
  process.env.PAT_AUTH_FAILURE_LIMIT ?? '24',
  10,
);
const patAuthFailureWindowSeconds = Number.parseInt(
  process.env.PAT_AUTH_FAILURE_WINDOW_SECONDS ?? '300',
  10,
);
const apiInternalUrl = process.env.API_INTERNAL_URL?.trim() || 'http://api:4000';
const internalRpcToken = process.env.INTERNAL_RPC_TOKEN?.trim() || '';

const INTERNAL_CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'access-control-max-age',
  'vary',
];

server.addHook('onRequest', async (request, reply) => {
  if (!reply.hasHeader('x-request-id')) {
    reply.header('x-request-id', request.id);
  }

  const requestUrl = request.raw.url ?? '';
  if (request.method === 'OPTIONS' && requestUrl.startsWith('/internal/')) {
    reply.hijack();
    reply.raw.statusCode = 404;
    reply.raw.setHeader('content-type', 'application/json; charset=utf-8');
    reply.raw.end(JSON.stringify({ message: 'Not found.' }));
    return;
  }
});

await server.register(cors, {
  origin: true,
  preflight: false,
});

await server.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
});

server.addHook('onSend', async (request, reply, payload) => {
  const requestUrl = request.raw.url ?? '';
  if (requestUrl.startsWith('/internal/')) {
    for (const headerName of INTERNAL_CORS_HEADERS) {
      reply.removeHeader(headerName);
      reply.raw.removeHeader(headerName);
    }
  }
  return payload;
});

server.get('/health', async () => {
  return { status: 'ok' };
});

server.get('/ready', async (request, reply) => {
  const checks = {
    db: { ok: true as boolean, message: '' },
    redis: { ok: true as boolean, message: '' },
  };

  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (error) {
    checks.db = {
      ok: false,
      message: error instanceof Error ? error.message : 'DB unavailable.',
    };
  }

  try {
    const redis = await getRedisClient();
    if (!redis) {
      checks.redis = { ok: false, message: 'Redis unavailable.' };
    } else {
      const pong = await redis.ping();
      if (pong.toUpperCase() !== 'PONG') {
        checks.redis = { ok: false, message: `Unexpected ping: ${pong}` };
      }
    }
  } catch (error) {
    checks.redis = {
      ok: false,
      message: error instanceof Error ? error.message : 'Redis unavailable.',
    };
  }

  const ok = checks.db.ok && checks.redis.ok;
  if (!ok) {
    return reply.code(503).send({ ok, checks });
  }
  return { ok, checks };
});

server.post(
  '/internal/rpc/tree',
  {
    config: { cors: false },
  },
  async (request, reply) => {
    if (!isAuthorizedInternalRpcRequest(request, reply)) {
      return;
    }

    const body = asRecord(request.body);
    if (!body) {
      return reply.code(400).send({ message: 'Invalid request body.' });
    }

    const repoId = readRequiredString(body.repoId);
    const branch = readRequiredString(body.branch);
    if (!repoId || !branch) {
      return reply.code(400).send({ message: 'repoId and branch are required.' });
    }

    const rawPath = readOptionalString(body.path) ?? '';
    let targetPath = '';
    try {
      targetPath = normalizeRepoPath(rawPath);
    } catch {
      return reply.code(400).send({ message: 'Invalid path.' });
    }

    const repoDir = await resolveRepoDirById(repoId);
    if (!repoDir) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const entries = await listRepoTree(repoDir, branch, targetPath);
    return { branch, path: targetPath, entries };
  },
);

server.post(
  '/internal/rpc/blob',
  {
    config: { cors: false },
  },
  async (request, reply) => {
    if (!isAuthorizedInternalRpcRequest(request, reply)) {
      return;
    }

    const body = asRecord(request.body);
    if (!body) {
      return reply.code(400).send({ message: 'Invalid request body.' });
    }

    const repoId = readRequiredString(body.repoId);
    const branch = readRequiredString(body.branch);
    const rawPath = readRequiredString(body.path);
    if (!repoId || !branch || !rawPath) {
      return reply
        .code(400)
        .send({ message: 'repoId, branch, and path are required.' });
    }

    let targetPath = '';
    try {
      targetPath = normalizeRepoPath(rawPath);
    } catch {
      return reply.code(400).send({ message: 'Invalid path.' });
    }
    if (!targetPath) {
      return reply.code(400).send({ message: 'Invalid path.' });
    }

    const repoDir = await resolveRepoDirById(repoId);
    if (!repoDir) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const blob = await readRepoBlob(repoDir, branch, targetPath);
    if (!blob) {
      return reply.code(404).send({ message: 'File not found.' });
    }
    return { blob };
  },
);

server.post(
  '/internal/rpc/commits',
  {
    config: { cors: false },
  },
  async (request, reply) => {
    if (!isAuthorizedInternalRpcRequest(request, reply)) {
      return;
    }

    const body = asRecord(request.body);
    if (!body) {
      return reply.code(400).send({ message: 'Invalid request body.' });
    }

    const repoId = readRequiredString(body.repoId);
    const branch = readRequiredString(body.branch);
    const limit = parseCommitLimit(body.limit);
    if (!repoId || !branch || limit === null) {
      return reply
        .code(400)
        .send({ message: 'repoId, branch, and limit are required.' });
    }

    const repoDir = await resolveRepoDirById(repoId);
    if (!repoDir) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const commits = await listCommits(repoDir, branch, limit);
    return { commits, branch, limit };
  },
);

server.route({
  method: ['GET', 'POST', 'HEAD'],
  url: '/*',
  handler: async (request, reply) => {
    if (!request.raw.url) {
      return reply.code(400).send({ message: 'Invalid request.' });
    }

    const url = new URL(request.raw.url, 'http://localhost');
    const pathName = url.pathname;
    const segments = pathName.split('/').filter(Boolean);

    if (segments.length < 2) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const workspaceSlug = segments[0];
    const repoPart = segments[1];
    if (!repoPart.endsWith('.git')) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const repoSlug = repoPart.slice(0, -4);
    const repo = await prisma.repo.findFirst({
      where: {
        slug: repoSlug,
        workspace: {
          slug: workspaceSlug,
        },
      },
      select: {
        id: true,
        slug: true,
        visibility: true,
        publicReadRequiresAuth: true,
        workspaceId: true,
        workspace: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!repo) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const service = parseGitService(pathName, url.searchParams.toString());
    const isReceivePack = service === 'git-receive-pack';
    const isUploadPack = service === 'git-upload-pack';
    const requiredRole = isReceivePack ? 'WRITE' : 'READ';

    if (isUploadPack) {
      const limited = await enforceGitRateLimit({
        reply,
        key: buildRateLimitKey([
          'git',
          'upload-pack',
          repo.workspace.slug,
          repo.slug,
          request.ip?.trim() || 'unknown-ip',
        ]),
        limit: gitUploadPackRateLimit,
        windowSeconds: gitUploadPackRateWindowSeconds,
        message: 'Too many git upload-pack requests. Try again shortly.',
      });
      if (!limited) {
        return;
      }
    }

    if (isReceivePack) {
      const limited = await enforceGitRateLimit({
        reply,
        key: buildRateLimitKey([
          'git',
          'receive-pack',
          repo.workspace.slug,
          repo.slug,
          request.ip?.trim() || 'unknown-ip',
        ]),
        limit: gitReceivePackRateLimit,
        windowSeconds: gitReceivePackRateWindowSeconds,
        message: 'Too many git receive-pack requests. Try again shortly.',
      });
      if (!limited) {
        return;
      }
    }

    const auth = await resolveRequestAuthContext(request, reply);
    if (!auth) {
      return;
    }

    if (auth.pat) {
      if (
        isReceivePack &&
        !hasPatScope(auth.pat.scopes, 'repo:write')
      ) {
        return reply
          .code(403)
          .send({ message: 'Token missing required scope: repo:write.' });
      }
      if (
        !isReceivePack &&
        !(
          hasPatScope(auth.pat.scopes, 'repo:read') ||
          hasPatScope(auth.pat.scopes, 'repo:write')
        )
      ) {
        return reply
          .code(403)
          .send({ message: 'Token missing required scope: repo:read.' });
      }
    }

    const access = await getRepoAccessByRef(auth.userId, workspaceSlug, repoSlug);
    if (!access) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    const canReadPublic =
      requiredRole === 'READ' &&
      (isPublicReadable(access) ||
        (Boolean(auth.userId) && access.repo.visibility === 'PUBLIC'));

    const hasRole = hasRequiredRole(access.role, requiredRole);
    if (!hasRole && !canReadPublic) {
      const status = auth.userId ? 403 : 401;
      const message = auth.userId ? 'Forbidden.' : 'Authentication required.';
      if (status === 401) {
        reply.header('WWW-Authenticate', 'Basic realm="Uynis"');
      }
      return reply.code(status).send({ message });
    }

    reply.hijack();
    const result = await proxyGitBackend({
      request,
      reply,
      repoRoot,
      pathName,
      query: url.searchParams.toString(),
      remoteUser: auth.userId ?? '',
    });

    if (
      isReceivePack &&
      auth.userId &&
      result.exitCode === 0 &&
      result.statusCode >= 200 &&
      result.statusCode < 400
    ) {
      void enqueuePushWebhookDeliveries({
        repoId: repo.id,
        payload: {
          requestId: request.id,
          eventType: 'PUSH',
          repoId: repo.id,
          workspaceSlug: repo.workspace.slug,
          repoSlug: repo.slug,
          actorId: auth.userId,
          receivedAt: new Date().toISOString(),
        },
      }).catch((error) => {
        server.log.warn(
          {
            err: error,
            repoId: repo.id,
          },
          'Unable to enqueue push webhook delivery',
        );
      });

      void requestCodeSearchReindex({
        repoId: repo.id,
        requestId: request.id,
      }).catch((error) => {
        server.log.warn(
          {
            err: error,
            repoId: repo.id,
          },
          'Unable to trigger code search reindex',
        );
      });
    }

    return result;
  },
});

const port = Number.parseInt(process.env.GIT_PORT ?? '4001', 10);
const host = process.env.GIT_HOST ?? '0.0.0.0';

server.listen({ port, host });

type ProxyInput = {
  request: FastifyRequest;
  reply: FastifyReply;
  repoRoot: string;
  pathName: string;
  query: string;
  remoteUser: string;
};

type RequestAuthContext = {
  userId: string | null;
  pat: GitPersonalAccessToken | null;
};

type ProxyResult = {
  statusCode: number;
  exitCode: number | null;
};

async function proxyGitBackend({
  request,
  reply,
  repoRoot,
  pathName,
  query,
  remoteUser,
}: ProxyInput): Promise<ProxyResult> {
  const env = {
    ...process.env,
    GIT_PROJECT_ROOT: repoRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathName,
    QUERY_STRING: query,
    REQUEST_METHOD: request.method,
    CONTENT_TYPE: request.headers['content-type'] ?? '',
    CONTENT_LENGTH: request.headers['content-length'] ?? '',
    REMOTE_USER: remoteUser,
  };

  const child = spawn('git', ['http-backend'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const response = reply.raw;
  let headerBuffer = Buffer.alloc(0);
  let headersSent = false;
  let resolved = false;
  let statusCode = 200;
  let childExitCode: number | null = null;

  const finalize = () => {
    if (!resolved) {
      resolved = true;
    }
  };

  child.stdout.on('data', (chunk) => {
    if (headersSent) {
      response.write(chunk);
      return;
    }

    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const split = splitHeaders(headerBuffer);
    if (!split) {
      return;
    }

    const { headers, rest, statusCode: splitStatusCode } = split;
    statusCode = splitStatusCode;
    response.statusCode = splitStatusCode;
    for (const [key, value] of Object.entries(headers)) {
      response.setHeader(key, value);
    }
    headersSent = true;
    if (rest.length > 0) {
      response.write(rest);
    }
  });

  child.stderr.on('data', (chunk) => {
    server.log.error({ err: chunk.toString() }, 'git-http-backend stderr');
  });

  child.on('error', (error) => {
    server.log.error({ err: error }, 'git-http-backend failed');
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader('content-type', 'text/plain');
      response.end('git-http-backend failed');
    } else if (!response.writableEnded) {
      response.end();
    }
    finalize();
  });

  child.on('close', (code) => {
    childExitCode = code;
    if (!response.writableEnded) {
      response.end();
    }
    finalize();
  });

  request.raw.pipe(child.stdin);

  await new Promise<void>((resolve) => {
    const maybeResolve = () => {
      if (resolved) {
        resolve();
      }
    };
    child.on('close', maybeResolve);
    child.on('error', maybeResolve);
  });

  return {
    statusCode,
    exitCode: childExitCode,
  };
}

function splitHeaders(buffer: Buffer): {
  statusCode: number;
  headers: Record<string, string>;
  rest: Buffer;
} | null {
  const rnIndex = buffer.indexOf('\r\n\r\n');
  const nIndex = buffer.indexOf('\n\n');

  let index = -1;
  let length = 0;

  if (rnIndex !== -1 && (nIndex === -1 || rnIndex < nIndex)) {
    index = rnIndex;
    length = 4;
  } else if (nIndex !== -1) {
    index = nIndex;
    length = 2;
  }

  if (index === -1) {
    return null;
  }

  const headerText = buffer.slice(0, index).toString('utf8');
  const rest = buffer.slice(index + length);
  const lines = headerText.split(/\r?\n/).filter(Boolean);

  let statusCode = 200;
  const headers: Record<string, string> = {};

  for (const line of lines) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (key.toLowerCase() === 'status') {
      const match = value.match(/^(\d{3})/);
      if (match) {
        statusCode = Number.parseInt(match[1], 10);
      }
    } else {
      headers[key] = value;
    }
  }

  return { statusCode, headers, rest };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value.trim();
}

function parseCommitLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return null;
  }
  if (value < 1 || value > 200) {
    return null;
  }
  return value;
}

function isAuthorizedInternalRpcRequest(request: FastifyRequest, reply: FastifyReply): boolean {
  const verification = verifyInternalRpcRequest(request);
  if (!verification.ok) {
    reply.code(401).send({ message: verification.reason });
    return false;
  }
  return true;
}

function parseGitService(pathname: string, query: string) {
  const params = new URLSearchParams(query);
  const service = params.get('service');
  const pathService = pathname.endsWith('/git-receive-pack')
    ? 'git-receive-pack'
    : pathname.endsWith('/git-upload-pack')
      ? 'git-upload-pack'
      : null;
  return service ?? pathService;
}

function buildRateLimitKey(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(':');
}

async function enforceGitRateLimit(input: {
  reply: FastifyReply;
  key: string;
  limit: number;
  windowSeconds: number;
  message: string;
}) {
  const result = await checkRateLimit({
    key: input.key,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
  });

  input.reply.header('x-ratelimit-limit', String(result.limit));
  input.reply.header('x-ratelimit-remaining', String(result.remaining));
  input.reply.header('x-ratelimit-reset', String(result.retryAfterSeconds));

  if (result.allowed) {
    return true;
  }
  input.reply.header('retry-after', String(result.retryAfterSeconds));
  await input.reply.code(429).send({ message: input.message });
  return false;
}

function isLikelyJwtToken(value: string) {
  const parts = value.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

async function resolveRequestAuthContext(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<RequestAuthContext | null> {
  const authorizationHeader = request.headers.authorization;
  if (!authorizationHeader) {
    return { userId: null, pat: null };
  }

  const authCandidate = extractAuthTokenCandidate(authorizationHeader);
  if (!authCandidate) {
    return { userId: null, pat: null };
  }

  if (isPersonalAccessToken(authCandidate)) {
    const ip = request.ip?.trim() || 'unknown-ip';
    const attemptsAllowed = await enforceGitRateLimit({
      reply,
      key: buildRateLimitKey(['pat', 'auth', 'attempt', ip]),
      limit: patAuthAttemptLimit,
      windowSeconds: patAuthAttemptWindowSeconds,
      message: 'Too many token authentication attempts. Try again shortly.',
    });
    if (!attemptsAllowed) {
      return null;
    }

    const pat = await findActivePersonalAccessToken(authCandidate);
    if (!pat) {
      const failuresAllowed = await enforceGitRateLimit({
        reply,
        key: buildRateLimitKey(['pat', 'auth', 'failure', ip]),
        limit: patAuthFailureLimit,
        windowSeconds: patAuthFailureWindowSeconds,
        message: 'Too many failed token attempts. Try again later.',
      });
      if (!failuresAllowed) {
        return null;
      }
      // inform the client that basic auth is required; without a
      // "WWW-Authenticate" header Git will not send credentials at all
      // even if they are embedded in the URL.  this is the root cause of the
      // earlier authentication failures during `git clone`.
      reply.header('WWW-Authenticate', 'Basic realm="Uynis"');
      await reply.code(401).send({ message: 'Invalid authentication token.' });
      return null;
    }

    void touchPersonalAccessToken(pat.id).catch(() => {
      // Best-effort PAT usage tracking.
    });

    return { userId: pat.userId, pat };
  }

  if (
    authorizationHeader.startsWith('Bearer ') ||
    (authorizationHeader.startsWith('Basic ') && isLikelyJwtToken(authCandidate))
  ) {
    try {
      const payload = (await server.jwt.verify(authCandidate)) as { sub?: string };
      return { userId: payload.sub ?? null, pat: null };
    } catch {
      if (authorizationHeader.startsWith('Bearer ')) {
        // challenge even for bearer tokens so clients realise their token is
        // invalid and can refresh it.
        reply.header('WWW-Authenticate', 'Basic realm="Uynis"');
        await reply.code(401).send({ message: 'Invalid authentication token.' });
        return null;
      }
      return { userId: null, pat: null };
    }
  }

  return { userId: null, pat: null };
}

async function resolveRepoDirById(repoId: string): Promise<string | null> {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: {
      slug: true,
      workspace: {
        select: {
          slug: true,
        },
      },
    },
  });
  if (!repo) {
    return null;
  }

  try {
    return await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
  } catch {
    return null;
  }
}

async function requestCodeSearchReindex(input: { repoId: string; requestId?: string }) {
  if (!apiInternalUrl || !internalRpcToken) {
    return;
  }
  const response = await fetch(`${apiInternalUrl}/internal/search/code/reindex`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': internalRpcToken,
      ...(input.requestId ? { 'x-request-id': input.requestId } : {}),
    },
    body: JSON.stringify({
      repoId: input.repoId,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Failed to trigger code reindex (${response.status}).`);
  }
}
