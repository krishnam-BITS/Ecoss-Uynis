import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { prisma } from '@uynis/db';
import { requireRepoAccess } from '../lib/repo-access.js';
import { isPersonalAccessToken } from '../lib/pats.js';
import { ensureReceiveHook } from '../lib/git.js';

const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.startsWith('Basic ')) {
    return null;
  }
  const raw = value.slice(6);
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const [username, password = ''] = decoded.split(':');
    return { username, password };
  } catch {
    return null;
  }
}

function isJwtToken(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 3;
}

function coerceBearerToken(candidate: string): string | null {
  if (!candidate) {
    return null;
  }
  if (isPersonalAccessToken(candidate) || isJwtToken(candidate)) {
    return candidate;
  }
  return null;
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

function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes(required);
}

export async function gitHttpRoutes(server: FastifyInstance) {
  server.all('/git/:workspaceSlug/:repoSlug.git', async (request, reply) => {
    return handleGitRequest(request, reply);
  });

  server.all('/git/:workspaceSlug/:repoSlug.git/*', async (request, reply) => {
    return handleGitRequest(request, reply);
  });
}

async function handleGitRequest(request: FastifyRequest, reply: FastifyReply) {
  const params = request.params as { workspaceSlug: string; repoSlug: string };
  const repo = await prisma.repo.findFirst({
    where: {
      slug: params.repoSlug,
      workspace: { slug: params.workspaceSlug },
    },
    select: {
      id: true,
      workspaceId: true,
      slug: true,
      workspace: { select: { slug: true } },
    },
  });

  if (!repo) {
    return reply.code(404).send({ message: 'Repo not found.' });
  }

  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    const basic = decodeBasicAuth(authHeader);
    const candidate = basic?.password || basic?.username || '';
    const bearerToken = coerceBearerToken(candidate);
    if (bearerToken) {
      const header = `Bearer ${bearerToken}`;
      request.headers.authorization = header;
      if (request.raw?.headers) {
        request.raw.headers.authorization = header;
      }
    }
  }

  const rawUrl = request.raw.url ?? '';
  const [pathPart, query = ''] = rawUrl.split('?');
  const pathInfo = pathPart.replace(/^\/git/, '');
  const service = parseGitService(pathPart, query);

  const isPush = service === 'git-receive-pack';
  const accessResult = await requireRepoAccess(request, reply, {
    workspaceId: repo.workspaceId,
    repoId: repo.id,
    requiredRole: isPush ? 'WRITE' : 'READ',
    requireAuth: isPush,
  });
  if (!accessResult) {
    return;
  }

  if (request.pat?.scopes?.length) {
    const scopes = request.pat.scopes;
    if (isPush && !hasScope(scopes, 'repo:write')) {
      return reply
        .code(403)
        .send({ message: 'Token missing required scope: repo:write.' });
    }
    if (!isPush && !(hasScope(scopes, 'repo:read') || hasScope(scopes, 'repo:write'))) {
      return reply
        .code(403)
        .send({ message: 'Token missing required scope: repo:read.' });
    }
  }

  if (isPush) {
    const repoDir = path.join(repoRoot, repo.workspace.slug, `${repo.slug}.git`);
    try {
      await ensureReceiveHook(repoDir);
    } catch {
      return reply.code(500).send({ message: 'Unable to prepare repository hooks.' });
    }
  }

  reply.hijack();

  const env: Record<string, string> = {
    ...process.env,
    GIT_PROJECT_ROOT: repoRoot,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: pathInfo,
    QUERY_STRING: query,
    REQUEST_METHOD: request.method,
    CONTENT_TYPE: String(request.headers['content-type'] ?? ''),
    CONTENT_LENGTH: String(request.headers['content-length'] ?? ''),
    REMOTE_USER: accessResult.userId ?? '',
    REMOTE_ADDR: request.ip ?? '',
    REPO_STORAGE_PATH: repoRoot,
  };

  const gitProcess = spawn('git', ['http-backend'], { env });
  let headerBuffer = Buffer.alloc(0);
  let headersParsed = false;
  let statusCode = 200;

  const applyHeaders = (headerText: string) => {
    const lines = headerText.split('\r\n').filter(Boolean);
    for (const line of lines) {
      if (line.toLowerCase().startsWith('status:')) {
        const [, statusValue] = line.split(/:\s*/);
        const parsed = Number.parseInt(statusValue.split(' ')[0] ?? '', 10);
        if (!Number.isNaN(parsed)) {
          statusCode = parsed;
        }
        continue;
      }
      const [key, ...rest] = line.split(':');
      if (!key) {
        continue;
      }
      const value = rest.join(':').trim();
      if (value) {
        reply.raw.setHeader(key.trim(), value);
      }
    }
  };

  gitProcess.stdout.on('data', (chunk) => {
    if (headersParsed) {
      reply.raw.write(chunk);
      return;
    }

    headerBuffer = Buffer.concat([headerBuffer, chunk]);
    const delimiter = headerBuffer.indexOf('\r\n\r\n');
    if (delimiter === -1) {
      return;
    }

    const headerPart = headerBuffer.slice(0, delimiter).toString('utf8');
    applyHeaders(headerPart);
    reply.raw.statusCode = statusCode;
    headersParsed = true;

    const remaining = headerBuffer.slice(delimiter + 4);
    if (remaining.length) {
      reply.raw.write(remaining);
    }
  });

  gitProcess.stdout.on('end', () => {
    reply.raw.end();
  });

  gitProcess.on('error', () => {
    if (!reply.raw.headersSent) {
      reply.raw.statusCode = 500;
    }
    reply.raw.end();
  });

  if (request.method === 'POST' || request.method === 'PUT') {
    request.raw.pipe(gitProcess.stdin);
  } else {
    gitProcess.stdin.end();
  }
}

