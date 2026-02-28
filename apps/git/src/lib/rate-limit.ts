import { getRedisClient } from './redis.js';

function normalize(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export async function checkRateLimit(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}) {
  const limit = normalize(input.limit, 20);
  const windowSeconds = normalize(input.windowSeconds, 60);
  const redis = await getRedisClient();
  if (!redis) {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limit,
      limit,
      current: 0,
    };
  }

  let current = 0;
  let ttl = 0;
  try {
    current = await redis.incr(input.key);
    if (current === 1) {
      await redis.expire(input.key, windowSeconds);
      ttl = windowSeconds;
    } else {
      ttl = await redis.ttl(input.key);
    }
  } catch {
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: limit,
      limit,
      current: 0,
    };
  }

  return {
    allowed: current <= limit,
    retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
    remaining: Math.max(0, limit - current),
    limit,
    current,
  };
}
