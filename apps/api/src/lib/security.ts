import type { FastifyRequest } from 'fastify';
import { prisma, type SecurityEventType, type SecuritySeverity } from '@uynis/db';
import { isExpired } from './user-account.js';

const FAILURE_WINDOW_MS = 60 * 60 * 1000;
const LOGIN_LOCK_THRESHOLD = 5;
const PASSWORD_RESET_THRESHOLD = 10;
const LOGIN_LOCK_MINUTES = 15;
const STEP_UP_RISK_THRESHOLD = 20;

export type SecurityStateSnapshot = {
  failedLoginCount: number;
  lockedUntil: Date | null;
  riskScore: number;
  forceReverify: boolean;
  forcePasswordReset: boolean;
};

export function getRequestSecurityContext(request: FastifyRequest): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwarded = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : null;
  const ipAddress = (firstForwarded ?? request.ip ?? '').trim() || null;
  const userAgent = request.headers['user-agent']?.trim() || null;
  return { ipAddress, userAgent };
}

async function getOrCreateSecurityState(userId: string) {
  return prisma.userSecurityState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function recordSecurityEvent(input: {
  userId?: string | null;
  eventType: SecurityEventType;
  severity?: SecuritySeverity;
  identifier?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  metadata?: unknown;
}) {
  await prisma.securityEvent.create({
    data: {
      userId: input.userId ?? null,
      eventType: input.eventType,
      severity: input.severity ?? 'INFO',
      identifier: input.identifier ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      reason: input.reason ?? null,
      metadata:
        input.metadata !== undefined
          ? (input.metadata as Record<string, unknown>)
          : undefined,
    },
  });
}

export async function registerLoginFailure(input: {
  request: FastifyRequest;
  userId?: string | null;
  identifier: string;
  reason?: string;
}) {
  const context = getRequestSecurityContext(input.request);
  await recordSecurityEvent({
    userId: input.userId,
    eventType: 'LOGIN_FAILURE',
    severity: 'WARN',
    identifier: input.identifier,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    reason: input.reason ?? 'Invalid credentials.',
  });

  if (!input.userId) {
    return {
      lockedUntil: null,
      failedLoginCount: 0,
      forcePasswordReset: false,
    };
  }

  const now = new Date();
  const state = await getOrCreateSecurityState(input.userId);
  const withinWindow =
    state.lastFailedLoginAt &&
    now.getTime() - state.lastFailedLoginAt.getTime() <= FAILURE_WINDOW_MS;
  const nextFailedLoginCount = withinWindow ? state.failedLoginCount + 1 : 1;
  const shouldLock = nextFailedLoginCount >= LOGIN_LOCK_THRESHOLD;
  const lockedUntil = shouldLock
    ? new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000)
    : state.lockedUntil && !isExpired(state.lockedUntil, now)
      ? state.lockedUntil
      : null;
  const forcePasswordReset =
    state.forcePasswordReset || nextFailedLoginCount >= PASSWORD_RESET_THRESHOLD;
  const riskDelta = shouldLock ? 6 : 2;
  const nextRiskScore = Math.min(100, state.riskScore + riskDelta);

  await prisma.$transaction([
    prisma.userSecurityState.update({
      where: { userId: input.userId },
      data: {
        failedLoginCount: nextFailedLoginCount,
        lastFailedLoginAt: now,
        lockedUntil,
        forcePasswordReset,
        riskScore: nextRiskScore,
      },
    }),
    ...(forcePasswordReset
      ? [
          prisma.user.update({
            where: { id: input.userId },
            data: { passwordResetRequired: true },
          }),
        ]
      : []),
  ]);

  if (shouldLock) {
    await recordSecurityEvent({
      userId: input.userId,
      eventType: 'LOGIN_BLOCKED',
      severity: forcePasswordReset ? 'HIGH' : 'WARN',
      identifier: input.identifier,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      reason: 'Too many failed login attempts.',
      metadata: {
        failedLoginCount: nextFailedLoginCount,
        lockedUntil: lockedUntil?.toISOString() ?? null,
        forcePasswordReset,
      },
    });
  }

  return {
    failedLoginCount: nextFailedLoginCount,
    lockedUntil,
    forcePasswordReset,
  };
}

export async function registerLoginSuccess(input: {
  request: FastifyRequest;
  userId: string;
  identifier: string;
}) {
  const context = getRequestSecurityContext(input.request);
  const now = new Date();
  const state = await getOrCreateSecurityState(input.userId);

  let riskScore = Math.max(0, state.riskScore - 3);
  let suspiciousReason: string | null = null;
  let suspiciousSeverity: SecuritySeverity = 'WARN';

  if (state.lastLoginIp && context.ipAddress && state.lastLoginIp !== context.ipAddress) {
    riskScore = Math.min(100, riskScore + 8);
    suspiciousReason = 'Login IP changed.';
    suspiciousSeverity = 'HIGH';
  } else if (
    state.lastLoginUserAgent &&
    context.userAgent &&
    state.lastLoginUserAgent !== context.userAgent
  ) {
    riskScore = Math.min(100, riskScore + 3);
    suspiciousReason = 'Login user agent changed.';
  }

  const forceReverify = riskScore >= STEP_UP_RISK_THRESHOLD;

  await prisma.userSecurityState.update({
    where: { userId: input.userId },
    data: {
      failedLoginCount: 0,
      lastFailedLoginAt: null,
      lockedUntil: null,
      lastLoginAt: now,
      lastLoginIp: context.ipAddress,
      lastLoginUserAgent: context.userAgent,
      riskScore,
      forceReverify,
    },
  });

  await recordSecurityEvent({
    userId: input.userId,
    eventType: 'LOGIN_SUCCESS',
    severity: 'INFO',
    identifier: input.identifier,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  });

  if (suspiciousReason) {
    await recordSecurityEvent({
      userId: input.userId,
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: suspiciousSeverity,
      identifier: input.identifier,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      reason: suspiciousReason,
      metadata: {
        previousIp: state.lastLoginIp,
        previousUserAgent: state.lastLoginUserAgent,
        riskScore,
      },
    });
  }

  return {
    failedLoginCount: 0,
    lockedUntil: null,
    riskScore,
    forceReverify,
    forcePasswordReset: state.forcePasswordReset,
  } satisfies SecurityStateSnapshot;
}

export async function getSecurityState(userId: string): Promise<SecurityStateSnapshot> {
  const state = await getOrCreateSecurityState(userId);
  return {
    failedLoginCount: state.failedLoginCount,
    lockedUntil: state.lockedUntil,
    riskScore: state.riskScore,
    forceReverify: state.forceReverify,
    forcePasswordReset: state.forcePasswordReset,
  };
}

export async function clearStepUpRequirement(userId: string) {
  await prisma.userSecurityState.upsert({
    where: { userId },
    create: {
      userId,
      failedLoginCount: 0,
      forceReverify: false,
      riskScore: 0,
    },
    update: {
      failedLoginCount: 0,
      forceReverify: false,
      lockedUntil: null,
      riskScore: 0,
    },
  });
}

export async function clearPasswordResetRequirement(userId: string) {
  await prisma.$transaction([
    prisma.userSecurityState.upsert({
      where: { userId },
      create: {
        userId,
        forcePasswordReset: false,
      },
      update: {
        forcePasswordReset: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { passwordResetRequired: false },
    }),
  ]);
}