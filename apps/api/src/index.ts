import './types.js';
import Fastify from 'fastify';
import { prisma } from '@uynis/db';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { authRoutes } from './routes/auth.js';
import { workspaceRoutes } from './routes/workspaces.js';
import { meRoutes } from './routes/me.js';
import { usersRoutes } from './routes/users.js';
import { uploadRoutes } from './routes/uploads.js';
import { hookRoutes } from './routes/hooks.js';
import { issueRoutes } from './routes/issues.js';
import { pullRoutes } from './routes/pulls.js';
import { tasksRoutes } from './routes/tasks.js';
import { adminRoutes } from './routes/admin.js';
import { notificationRoutes } from './routes/notifications.js';
import { discussionsRoutes } from './routes/discussions.js';
import { searchRoutes } from './routes/search.js';
import { ensureActiveSession, sendSessionGuardResponse } from './lib/sessions.js';
import { isObjectStoreConfigured } from './lib/object-store.js';
import { startImportJobWorker } from './lib/import-worker.js';
import { attachPersonalAccessTokenToRequest } from './lib/pat-auth.js';
import { getReadinessReport } from './lib/readiness.js';
import { recordHttpRequest, renderPrometheusMetrics } from './lib/metrics.js';
import { ZodError } from 'zod';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL?.trim() || 'info',
    base: {
      service: 'api',
    },
  },
  requestIdHeader: 'x-request-id',
});

const requireRepoStoragePath = process.env.REQUIRE_REPO_STORAGE_PATH === 'true';
if (requireRepoStoragePath && !process.env.REPO_STORAGE_PATH?.trim()) {
  server.log.error(
    'REPO_STORAGE_PATH is required when REQUIRE_REPO_STORAGE_PATH=true. Refusing to start.',
  );
  process.exit(1);
}

await server.register(cors, {
  origin: true,
  credentials: true,
});

await server.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
});

await server.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

if (!isObjectStoreConfigured()) {
  server.log.warn(
    'Object store is not configured. Upload routes will fallback to legacy local reads and new writes may fail.',
  );
}

await server.register(swagger, {
  openapi: {
    info: {
      title: 'Uynis API',
      version: '0.1.0',
    },
  },
});

await server.register(swaggerUi, {
  routePrefix: '/docs',
});

server.addHook('onRequest', async (request, reply) => {
  if (!reply.hasHeader('x-request-id')) {
    reply.header('x-request-id', request.id);
  }

  const patAttached = await attachPersonalAccessTokenToRequest({ request, reply });
  if (!patAttached) {
    return reply;
  }

  if (request.pat) {
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return;
  }

  await request.jwtVerify();
  const guard = await ensureActiveSession(request);
  if (!guard.ok) {
    await sendSessionGuardResponse(reply, guard);
    return reply;
  }
});

server.addHook('onResponse', async (request, reply) => {
  const route = request.routeOptions.url || request.url;
  const responseTimeMs = typeof reply.elapsedTime === 'number' ? reply.elapsedTime : 0;
  recordHttpRequest({
    method: request.method,
    route,
    statusCode: reply.statusCode,
    durationSeconds: responseTimeMs / 1000,
  });
});

server.setErrorHandler((error, request, reply) => {
  if (error instanceof ZodError) {
    return reply
      .code(400)
      .send({ message: 'Invalid request.', issues: error.issues });
  }

  if (error.code === 'FST_JWT_NO_AUTHORIZATION_IN_HEADER') {
    return reply.code(401).send({ message: 'Authentication required.' });
  }
  if (error.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
    return reply.code(401).send({ message: 'Session expired. Please sign in again.' });
  }
  if (typeof error.code === 'string' && error.code.startsWith('FST_JWT_')) {
    return reply.code(401).send({ message: 'Invalid authentication token.' });
  }

  request.log.error(error);
  return reply
    .code(error.statusCode ?? 500)
    .send({ message: 'Server error.' });
});

server.get('/health', async () => {
  return { status: 'ok' };
});

server.get('/ready', async (request, reply) => {
  const report = await getReadinessReport();
  if (!report.ok) {
    return reply.code(503).send(report);
  }
  return report;
});

server.get('/metrics', async (_request, reply) => {
  let dynamicMetrics = '';
  try {
    const importJobsByStatus = await prisma.repoImportJob.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const webhookDeliveriesByStatus = await prisma.repoWebhookDelivery.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const lines: string[] = [];
    lines.push('# HELP uynis_worker_import_jobs_status Count of import jobs by status.');
    lines.push('# TYPE uynis_worker_import_jobs_status gauge');
    for (const row of importJobsByStatus) {
      lines.push(
        `uynis_worker_import_jobs_status{status="${row.status}"} ${row._count._all}`,
      );
    }

    lines.push(
      '# HELP uynis_worker_webhook_deliveries_status Count of webhook deliveries by status.',
    );
    lines.push('# TYPE uynis_worker_webhook_deliveries_status gauge');
    for (const row of webhookDeliveriesByStatus) {
      lines.push(
        `uynis_worker_webhook_deliveries_status{status="${row.status}"} ${row._count._all}`,
      );
    }
    dynamicMetrics = `${lines.join('\n')}\n`;
  } catch {
    dynamicMetrics = '';
  }

  reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
  return `${renderPrometheusMetrics()}${dynamicMetrics}`;
});

await server.register(authRoutes);
await server.register(meRoutes);
await server.register(usersRoutes);
await server.register(uploadRoutes);
await server.register(hookRoutes);
await server.register(workspaceRoutes);
await server.register(issueRoutes);
await server.register(pullRoutes);
await server.register(tasksRoutes);
await server.register(notificationRoutes);
await server.register(adminRoutes);
await server.register(discussionsRoutes);
await server.register(searchRoutes);

startImportJobWorker();

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const host = process.env.API_HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
} catch (error) {
  const maybeErr = error as NodeJS.ErrnoException;
  if (maybeErr.code === 'EADDRINUSE') {
    server.log.error(
      `Unable to start API. ${host}:${port} is already in use. Stop the existing process or set API_PORT to a free port.`,
    );
    process.exit(1);
  }
  throw error;
}
