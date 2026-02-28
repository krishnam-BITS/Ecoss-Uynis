import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL?.trim();
const sessionCacheTtlSeconds = Number.parseInt(
  process.env.SESSION_CACHE_TTL_SECONDS ?? '600',
  10,
);

let client: Redis | null = null;
let initialized = false;
let connectFailureUntil = 0;
let hasLoggedReady = false;

function createClient() {
  if (!redisUrl) {
    return null;
  }

  const nextClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  nextClient.on('ready', () => {
    if (!hasLoggedReady) {
      hasLoggedReady = true;
      // Keep log concise; this is used in verification proof.
      console.info('[redis] connected');
    }
  });

  nextClient.on('error', (error) => {
    console.warn(`[redis] error: ${error.message}`);
  });

  return nextClient;
}

export function isRedisConfigured() {
  return Boolean(redisUrl);
}

export function getSessionCacheTtlSeconds() {
  return Number.isFinite(sessionCacheTtlSeconds) && sessionCacheTtlSeconds > 0
    ? sessionCacheTtlSeconds
    : 600;
}

export async function getRedisClient() {
  if (!initialized) {
    client = createClient();
    initialized = true;
  }
  if (!client) {
    return null;
  }

  if (Date.now() < connectFailureUntil) {
    return null;
  }

  if (client.status === 'ready') {
    return client;
  }

  try {
    await client.connect();
    return client;
  } catch (error) {
    connectFailureUntil = Date.now() + 10_000;
    console.warn(
      `[redis] unavailable, falling back to DB-backed paths: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return null;
  }
}

export async function getRedisJson<T>(key: string): Promise<T | null> {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }
  try {
    const raw = await redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setRedisJson(key: string, value: unknown, ttlSeconds: number) {
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, ttlSeconds));
  } catch {
    // Best-effort cache write only.
  }
}

export async function deleteRedisKeys(keys: string[]) {
  if (!keys.length) {
    return;
  }
  const redis = await getRedisClient();
  if (!redis) {
    return;
  }
  try {
    await redis.del(...keys);
  } catch {
    // Best-effort cache invalidation only.
  }
}
