import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRedisClient } from './redis.js';

type RateLimitCheckInput = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitCheckResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  current: number;
};

function normalizePositiveInt(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function getClient() {
  return getRedisClient();
}

export async function checkRateLimit(
  input: RateLimitCheckInput,
): Promise<RateLimitCheckResult> {
  const limit = normalizePositiveInt(input.limit, 10);
  const windowSeconds = normalizePositiveInt(input.windowSeconds, 60);

  const redis = await getClient();
  if (!redis) {
    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
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
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
      current: 0,
    };
  }

  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
  const allowed = current <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - current),
    retryAfterSeconds,
    current,
  };
}

export async function enforceRateLimit(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  key: string;
  limit: number;
  windowSeconds: number;
  message?: string;
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
  await input.reply.code(429).send({
    message: input.message ?? 'Too many requests. Try again shortly.',
  });
  return false;
}

export function buildRateLimitKey(parts: Array<string | number | null | undefined>) {
  return parts
    .map((part) => (part ?? '').toString().trim())
    .filter(Boolean)
    .join(':');
}
