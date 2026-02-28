import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL?.trim();
let client: Redis | null = null;
let initialized = false;
let failureUntil = 0;

function createClient() {
  if (!redisUrl) {
    return null;
  }
  const next = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  next.on('error', (error) => {
    console.warn(`[git-redis] error: ${error.message}`);
  });
  return next;
}

export async function getRedisClient() {
  if (!initialized) {
    client = createClient();
    initialized = true;
  }
  if (!client) {
    return null;
  }
  if (Date.now() < failureUntil) {
    return null;
  }
  if (client.status === 'ready') {
    return client;
  }
  try {
    await client.connect();
    return client;
  } catch {
    failureUntil = Date.now() + 10_000;
    return null;
  }
}
