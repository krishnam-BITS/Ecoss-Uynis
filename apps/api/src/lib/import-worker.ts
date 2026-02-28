import { prisma } from '@uynis/db';
import { processImportJob } from './import-jobs.js';
import { processPendingWebhookDeliveries } from './repo-webhooks.js';
import { recordWorkerJobResult } from './metrics.js';

const pollIntervalMs = Number.parseInt(
  process.env.IMPORT_JOB_POLL_MS ?? '3000',
  10,
);
const staleAfterMs = Number.parseInt(
  process.env.IMPORT_JOB_STALE_MS ?? '1800000',
  10,
);
const workerEnabled =
  (process.env.IMPORT_WORKER_ENABLED ?? 'true').trim().toLowerCase() !== 'false';

let isRunning = false;
let importJobsDisabled = false;
let lastTransientErrorLogAt = 0;

function shouldDisableWorker(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const prismaError = error as { code?: string; meta?: { modelName?: string; table?: string } };
  if (prismaError.code === 'P2021') {
    console.warn(
      '[import-worker] RepoImportJob table is missing. Run migrations to enable import jobs.',
    );
    return true;
  }
  return false;
}

function disableImportJobs(message: string) {
  if (importJobsDisabled) {
    return;
  }
  importJobsDisabled = true;
  console.warn(`[import-worker] ${message}`);
}

function isTransientError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const prismaError = error as { code?: string; name?: string };
  return (
    prismaError.name === 'PrismaClientInitializationError' ||
    prismaError.code === 'P1001' ||
    prismaError.code === 'P1008' ||
    prismaError.code === 'P1017'
  );
}

function logTransientError(error: unknown) {
  const now = Date.now();
  // Avoid noisy logs while DB is unavailable.
  if (now - lastTransientErrorLogAt < 30_000) {
    return;
  }
  lastTransientErrorLogAt = now;
  const message =
    error instanceof Error ? error.message : 'Unknown worker error';
  console.warn(`[import-worker] Transient error: ${message}`);
}

async function requeueStaleJobs() {
  if (importJobsDisabled) {
    return;
  }
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - staleAfterMs);
  try {
    await prisma.repoImportJob.updateMany({
      where: {
        status: 'RUNNING',
        updatedAt: { lt: cutoff },
      },
      data: {
        status: 'QUEUED',
        error: 'Import was re-queued after stale execution.',
      },
    });
  } catch (error) {
    if (shouldDisableWorker(error)) {
      disableImportJobs(
        'Import jobs disabled because RepoImportJob table is unavailable. Webhook delivery worker remains active.',
      );
      return;
    }
    throw error;
  }
}

async function pollOnce() {
  if (isRunning) {
    return;
  }
  isRunning = true;
  try {
    if (!importJobsDisabled) {
      await requeueStaleJobs();
      let job = null;
      try {
        job = await prisma.repoImportJob.findFirst({
          where: {
            status: 'QUEUED',
            OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
          },
          orderBy: { createdAt: 'asc' },
        });
      } catch (error) {
        if (shouldDisableWorker(error)) {
          disableImportJobs(
            'Import jobs disabled because RepoImportJob table is unavailable. Webhook delivery worker remains active.',
          );
        } else {
          throw error;
        }
      }
      if (job) {
        const result = await processImportJob(job.id);
        if (result === 'completed') {
          recordWorkerJobResult('processed');
        } else if (result === 'retried') {
          recordWorkerJobResult('retried');
        } else if (result === 'failed') {
          recordWorkerJobResult('failed');
        }
      }
    }
    await processPendingWebhookDeliveries();
  } catch (error) {
    if (shouldDisableWorker(error)) {
      disableImportJobs(
        'Import jobs disabled because RepoImportJob table is unavailable. Webhook delivery worker remains active.',
      );
    }
    if (isTransientError(error)) {
      logTransientError(error);
      return;
    }
    const message =
      error instanceof Error ? error.message : 'Unknown worker failure';
    console.error(`[import-worker] Worker loop failed: ${message}`);
  } finally {
    isRunning = false;
  }
}

export function startImportJobWorker() {
  if (!workerEnabled) {
    console.info('[import-worker] Disabled by IMPORT_WORKER_ENABLED=false');
    return;
  }
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    return;
  }
  void pollOnce().catch((error) => {
    const message =
      error instanceof Error ? error.message : 'Unknown worker startup error';
    console.error(`[import-worker] Startup failed: ${message}`);
  });
  setInterval(() => {
    void pollOnce().catch((error) => {
      const message =
        error instanceof Error ? error.message : 'Unknown worker interval error';
      console.error(`[import-worker] Interval failed: ${message}`);
    });
  }, pollIntervalMs);
}
