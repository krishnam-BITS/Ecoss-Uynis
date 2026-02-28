import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@uynis/db';
import { getRequestSecurityContext, recordSecurityEvent } from './security.js';
import { isExpired } from './user-account.js';
import {
  deleteRedisKeys,
  getRedisJson,
  getSessionCacheTtlSeconds,
  setRedisJson,
} from './redis.js';
import { recordRedisCacheResult } from './metrics.js';

const DEFAULT_IDLE_MINUTES = Number.parseInt(
  process.env.AUTH_SESSION_IDLE_MINUTES ?? '720',
  10,
);
const DEFAULT_MAX_AGE_DAYS = Number.parseInt(
  process.env.AUTH_SESSION_MAX_AGE_DAYS ?? '30',
  10,
);

type SessionGuardResult = {
  ok: boolean;
  status?: number;
  message?: string;
  requiresVerification?: boolean;
  requiresPasswordReset?: boolean;
};

type SessionCacheEntry = {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  user: {
    id: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    passwordResetRequired: boolean;
    passwordChangedAt: string | null;
    securityState: {
      forcePasswordReset: boolean;
      forceReverify: boolean;
    } | null;
  };
};

function getSessionCacheKey(tokenId: string) {
  return `auth:session:${tokenId}`;
}

export async function invalidateSessionCacheByTokenId(tokenId: string) {
  await deleteRedisKeys([getSessionCacheKey(tokenId)]);
}

function toSessionCacheEntry(session: {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    emailVerified: boolean;
    phoneVerified: boolean;
    passwordResetRequired: boolean;
    passwordChangedAt: Date | null;
    securityState: {
      forcePasswordReset: boolean;
      forceReverify: boolean;
    } | null;
  };
}): SessionCacheEntry {
  return {
    id: session.id,
    userId: session.userId,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    user: {
      id: session.user.id,
      emailVerified: session.user.emailVerified,
      phoneVerified: session.user.phoneVerified,
      passwordResetRequired: session.user.passwordResetRequired,
      passwordChangedAt: session.user.passwordChangedAt
        ? session.user.passwordChangedAt.toISOString()
        : null,
      securityState: session.user.securityState
        ? {
            forcePasswordReset: session.user.securityState.forcePasswordReset,
            forceReverify: session.user.securityState.forceReverify,
          }
        : null,
    },
  };
}

function fromSessionCacheEntry(entry: SessionCacheEntry) {
  return {
    id: entry.id,
    userId: entry.userId,
    createdAt: new Date(entry.createdAt),
    lastSeenAt: new Date(entry.lastSeenAt),
    expiresAt: new Date(entry.expiresAt),
    revokedAt: entry.revokedAt ? new Date(entry.revokedAt) : null,
    user: {
      id: entry.user.id,
      emailVerified: entry.user.emailVerified,
      phoneVerified: entry.user.phoneVerified,
      passwordResetRequired: entry.user.passwordResetRequired,
      passwordChangedAt: entry.user.passwordChangedAt
        ? new Date(entry.user.passwordChangedAt)
        : null,
      securityState: entry.user.securityState,
    },
  };
}

export async function createUserSession(input: {
  request: FastifyRequest;
  userId: string;
  tokenId: string;
  expiresAt: Date;
}) {
  const context = getRequestSecurityContext(input.request);
  const session = await prisma.userSession.create({
    data: {
      userId: input.userId,
      tokenId: input.tokenId,
      expiresAt: input.expiresAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    },
  });

  await deleteRedisKeys([getSessionCacheKey(input.tokenId)]);
  return session;
}

export async function revokeUserSessions(input: {
  userId: string;
  exceptTokenId?: string | null;
}) {
  const activeSessions = await prisma.userSession.findMany({
    where: {
      userId: input.userId,
      revokedAt: null,
      tokenId: input.exceptTokenId ? { not: input.exceptTokenId } : undefined,
    },
    select: {
      tokenId: true,
    },
  });

  const result = await prisma.userSession.updateMany({
    where: {
      userId: input.userId,
      revokedAt: null,
      tokenId: input.exceptTokenId ? { not: input.exceptTokenId } : undefined,
    },
    data: {
      revokedAt: new Date(),
    },
  });

  await deleteRedisKeys(
    activeSessions.map((session) => getSessionCacheKey(session.tokenId)),
  );

  return result;
}

function buildSessionGuardResult(params: {
  status: number;
  message: string;
  requiresVerification?: boolean;
  requiresPasswordReset?: boolean;
}): SessionGuardResult {
  return {
    ok: false,
    status: params.status,
    message: params.message,
    requiresVerification: params.requiresVerification,
    requiresPasswordReset: params.requiresPasswordReset,
  };
}

export async function ensureActiveSession(
  request: FastifyRequest,
): Promise<SessionGuardResult> {
  const tokenId = request.user?.jti;
  if (!tokenId) {
    return buildSessionGuardResult({
      status: 401,
      message: 'Session expired. Please sign in again.',
    });
  }

  const sessionCacheKey = getSessionCacheKey(tokenId);
  const cached = await getRedisJson<SessionCacheEntry>(sessionCacheKey);
  recordRedisCacheResult(cached ? 'hit' : 'miss');
  const session =
    cached !== null
      ? fromSessionCacheEntry(cached)
      : await prisma.userSession.findUnique({
          where: { tokenId },
          select: {
            id: true,
            userId: true,
            createdAt: true,
            lastSeenAt: true,
            expiresAt: true,
            revokedAt: true,
            user: {
              select: {
                id: true,
                emailVerified: true,
                phoneVerified: true,
                passwordResetRequired: true,
                passwordChangedAt: true,
                securityState: {
                  select: {
                    forcePasswordReset: true,
                    forceReverify: true,
                  },
                },
              },
            },
          },
        });

  if (cached) {
    console.info('[sessions] cache hit');
  }

  if (!session || session.userId !== request.user?.sub) {
    return buildSessionGuardResult({
      status: 401,
      message: 'Session expired. Please sign in again.',
    });
  }

  const now = new Date();
  if (session.revokedAt || isExpired(session.expiresAt, now)) {
    await deleteRedisKeys([sessionCacheKey]);
    return buildSessionGuardResult({
      status: 401,
      message: 'Session expired. Please sign in again.',
    });
  }

  const passwordChangedAt = session.user.passwordChangedAt;
  if (passwordChangedAt && session.createdAt < passwordChangedAt) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });
    await deleteRedisKeys([sessionCacheKey]);
    return buildSessionGuardResult({
      status: 401,
      message: 'Password updated. Please sign in again.',
    });
  }

  if (session.user.passwordResetRequired || session.user.securityState?.forcePasswordReset) {
    return buildSessionGuardResult({
      status: 403,
      message: 'Password reset required.',
      requiresPasswordReset: true,
    });
  }

  if (session.user.securityState?.forceReverify) {
    const hasVerifiedContact = session.user.emailVerified || session.user.phoneVerified;
    if (!hasVerifiedContact) {
      return buildSessionGuardResult({
        status: 403,
        message: 'Additional verification required for this sign-in.',
        requiresVerification: true,
      });
    }
  }

  const idleLimitMs = DEFAULT_IDLE_MINUTES * 60 * 1000;
  if (idleLimitMs > 0 && now.getTime() - session.lastSeenAt.getTime() > idleLimitMs) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });
    await deleteRedisKeys([sessionCacheKey]);
    await recordSecurityEvent({
      userId: session.userId,
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: 'WARN',
      identifier: request.user?.email ?? null,
      reason: 'Session idle timeout exceeded.',
      metadata: {
        idleMinutes: DEFAULT_IDLE_MINUTES,
      },
    });
    return buildSessionGuardResult({
      status: 401,
      message: 'Session expired. Please sign in again.',
    });
  }

  const maxAgeMs = DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (maxAgeMs > 0 && now.getTime() - session.createdAt.getTime() > maxAgeMs) {
    await prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });
    await deleteRedisKeys([sessionCacheKey]);
    return buildSessionGuardResult({
      status: 401,
      message: 'Session expired. Please sign in again.',
    });
  }

  await prisma.userSession.update({
    where: { id: session.id },
    data: { lastSeenAt: now },
  });

  await setRedisJson(
    sessionCacheKey,
    toSessionCacheEntry({
      ...session,
      lastSeenAt: now,
    }),
    getSessionCacheTtlSeconds(),
  );

  return { ok: true };
}

export async function sendSessionGuardResponse(
  reply: FastifyReply,
  guard: SessionGuardResult,
): Promise<void> {
  if (guard.ok) {
    return;
  }
  reply.code(guard.status ?? 401).send({
    message: guard.message ?? 'Session expired. Please sign in again.',
    requiresVerification: guard.requiresVerification,
    requiresPasswordReset: guard.requiresPasswordReset,
  });
}
