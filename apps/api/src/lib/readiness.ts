import { prisma } from '@uynis/db';
import { checkObjectStoreReadiness } from './object-store.js';
import { checkOpenSearchReadiness } from './opensearch.js';
import { getRedisClient } from './redis.js';

export type ReadinessCheck = {
  ok: boolean;
  message?: string;
};

export type ReadinessReport = {
  ok: boolean;
  checks: {
    db: ReadinessCheck;
    redis: ReadinessCheck;
    objectStore: ReadinessCheck;
    opensearch: ReadinessCheck;
  };
};

async function checkDbReadiness(): Promise<ReadinessCheck> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Database unavailable.',
    };
  }
}

async function checkRedisReadiness(): Promise<ReadinessCheck> {
  try {
    const redis = await getRedisClient();
    if (!redis) {
      return { ok: false, message: 'Redis client unavailable.' };
    }
    const pong = await redis.ping();
    if (pong.toUpperCase() !== 'PONG') {
      return { ok: false, message: `Unexpected Redis ping response: ${pong}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Redis unavailable.',
    };
  }
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const [db, redis, objectStore, opensearch] = await Promise.all([
    checkDbReadiness(),
    checkRedisReadiness(),
    checkObjectStoreReadiness(),
    checkOpenSearchReadiness(),
  ]);

  return {
    ok: db.ok && redis.ok && objectStore.ok && opensearch.ok,
    checks: {
      db,
      redis,
      objectStore,
      opensearch,
    },
  };
}
