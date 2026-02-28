import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@uynis/db';
import { z } from 'zod';
import { isExpired } from '../lib/user-account.js';
import { hasPatScope } from '../lib/pat-auth.js';
import { getReadinessReport } from '../lib/readiness.js';
import { isConfiguredSystemAdmin } from '../lib/system-admin.js';

const SECURITY_EVENT_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGIN_BLOCKED',
  'REQUIRES_VERIFICATION',
  'REQUIRES_PASSWORD_RESET',
  'OTP_VERIFIED',
  'PASSWORD_RESET',
  'SUSPICIOUS_ACTIVITY',
] as const;

const SECURITY_SEVERITIES = ['INFO', 'WARN', 'HIGH', 'CRITICAL'] as const;

const securityEventQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  eventType: z.enum(SECURITY_EVENT_TYPES).optional(),
  severity: z.enum(SECURITY_SEVERITIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const anomalyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().trim().min(1).optional(),
});

const webhookListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  active: z
    .string()
    .optional()
    .transform((value) =>
      value === 'true' ? true : value === 'false' ? false : undefined,
    ),
});

const importJobListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
});

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ id: string; email: string | null } | null> {
  const isPatAuth = Boolean(request.pat);
  let viewerId: string | null = null;
  if (isPatAuth) {
    if (!request.pat || !hasPatScope(request.pat.scopes, 'platform:admin')) {
      reply.code(403).send({ message: 'Token missing required scope: platform:admin.' });
      return null;
    }
    viewerId = request.pat.userId;
  } else {
    await request.jwtVerify();
    viewerId = request.user.sub;
  }

  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { id: true, email: true },
  });

  if (!viewer) {
    reply.code(401).send({ message: 'Authentication required.' });
    return null;
  }

  if (!isConfiguredSystemAdmin(viewer)) {
    // Hide admin surface from non-admin identities.
    reply.code(404).send({ message: 'Not found.' });
    return null;
  }

  return viewer;
}

function buildVerificationAnomalies(user: {
  email: string | null;
  phone: string | null;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  verificationExpiresAt: Date | null;
  emailVerificationExpiresAt: Date | null;
  phoneVerificationExpiresAt: Date | null;
  passwordResetRequired: boolean;
  privateAccount: { status: string } | null;
  securityState: {
    forceReverify: boolean;
    forcePasswordReset: boolean;
    lockedUntil: Date | null;
  } | null;
}): string[] {
  const anomalies: string[] = [];
  const hasActivePrivateAccount = user.privateAccount?.status === 'ACTIVE';
  const hasVerifiedContact = user.emailVerified || user.phoneVerified;
  const emailExpiry = user.emailVerificationExpiresAt ?? user.verificationExpiresAt;
  const phoneExpiry = user.phoneVerificationExpiresAt ?? user.verificationExpiresAt;
  const now = new Date();

  if (user.isVerified && !hasActivePrivateAccount && !hasVerifiedContact) {
    anomalies.push('isVerified=true but no verified contact or active private account');
  }
  if (!user.isVerified && (hasActivePrivateAccount || hasVerifiedContact)) {
    anomalies.push(
      'isVerified=false despite verified contact or active private account',
    );
  }
  if (user.emailVerified && !user.email) {
    anomalies.push('emailVerified=true but email is missing');
  }
  if (user.phoneVerified && !user.phone) {
    anomalies.push('phoneVerified=true but phone is missing');
  }
  if (user.email && !user.emailVerified && isExpired(emailExpiry, now)) {
    anomalies.push('email verification window expired');
  }
  if (user.phone && !user.phoneVerified && isExpired(phoneExpiry, now)) {
    anomalies.push('phone verification window expired');
  }
  if (user.securityState?.forcePasswordReset && !user.passwordResetRequired) {
    anomalies.push('security state requires password reset but user flag is false');
  }
  if (!user.securityState?.forcePasswordReset && user.passwordResetRequired) {
    anomalies.push('user password reset flag set without security-state flag');
  }
  if (user.securityState?.lockedUntil && !isExpired(user.securityState.lockedUntil)) {
    anomalies.push('account lock is active');
  }
  if (user.securityState?.forceReverify && !hasVerifiedContact) {
    anomalies.push('step-up reverify required but user has no verified contact');
  }

  return anomalies;
}

export async function adminRoutes(server: FastifyInstance) {
  server.get('/admin/security/events', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = securityEventQuerySchema.parse(request.query);
    const events = await prisma.securityEvent.findMany({
      where: {
        userId: query.userId,
        eventType: query.eventType,
        severity: query.severity,
        createdAt:
          query.from || query.to
            ? {
                gte: query.from,
                lte: query.to,
              }
            : undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        userId: true,
        eventType: true,
        severity: true,
        identifier: true,
        ipAddress: true,
        userAgent: true,
        reason: true,
        metadata: true,
        createdAt: true,
      },
    });

    return { events };
  });

  server.get('/admin/security/state/:userId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        isVerified: true,
        emailVerified: true,
        phoneVerified: true,
        verificationExpiresAt: true,
        emailVerificationExpiresAt: true,
        phoneVerificationExpiresAt: true,
        passwordResetRequired: true,
        privateAccount: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
          },
        },
        securityState: {
          select: {
            failedLoginCount: true,
            lastFailedLoginAt: true,
            lastLoginAt: true,
            lockedUntil: true,
            riskScore: true,
            forceReverify: true,
            forcePasswordReset: true,
            lastLoginIp: true,
            lastLoginUserAgent: true,
            updatedAt: true,
          },
        },
        securityEvents: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            eventType: true,
            severity: true,
            identifier: true,
            reason: true,
            ipAddress: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const anomalies = buildVerificationAnomalies(user);
    return {
      user,
      anomalies,
    };
  });

  server.get('/admin/security/anomalies', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = anomalyQuerySchema.parse(request.query);
    const limit = query.limit ?? 50;
    const candidates = await prisma.user.findMany({
      take: Math.min(1000, Math.max(limit * 4, 200)),
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        name: true,
        isVerified: true,
        emailVerified: true,
        phoneVerified: true,
        verificationExpiresAt: true,
        emailVerificationExpiresAt: true,
        phoneVerificationExpiresAt: true,
        passwordResetRequired: true,
        updatedAt: true,
        privateAccount: {
          select: { status: true },
        },
        securityState: {
          select: {
            forceReverify: true,
            forcePasswordReset: true,
            lockedUntil: true,
            riskScore: true,
            failedLoginCount: true,
          },
        },
      },
    });

    const anomalies = candidates
      .map((user) => {
        const reasons = buildVerificationAnomalies(user);
        return reasons.length
          ? {
              user: {
                id: user.id,
                email: user.email,
                username: user.username,
                name: user.name,
              },
              reasons,
              riskScore: user.securityState?.riskScore ?? 0,
              failedLoginCount: user.securityState?.failedLoginCount ?? 0,
              updatedAt: user.updatedAt,
            }
          : null;
      })
      .filter(Boolean)
      .slice(0, limit);

    return { anomalies };
  });

  server.get('/admin/health', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const [readiness, totals] = await Promise.all([
      getReadinessReport(),
      prisma.$transaction([
        prisma.user.count(),
        prisma.workspace.count(),
        prisma.repo.count(),
        prisma.personalAccessToken.count(),
        prisma.repoWebhook.count(),
        prisma.repoImportJob.count(),
      ]),
    ]);

    return {
      readiness,
      totals: {
        users: totals[0],
        workspaces: totals[1],
        repos: totals[2],
        pats: totals[3],
        webhooks: totals[4],
        importJobs: totals[5],
      },
    };
  });

  server.get('/admin/users', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = listQuerySchema.parse(request.query ?? {});
    const users = await prisma.user.findMany({
      where: query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { username: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        isVerified: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { users };
  });

  server.get('/admin/workspaces', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = listQuerySchema.parse(request.query ?? {});
    const workspaces = await prisma.workspace.findMany({
      where: query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        createdAt: true,
        ownerUserId: true,
      },
    });
    return { workspaces };
  });

  server.get('/admin/repos', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = listQuerySchema.parse(request.query ?? {});
    const repos = await prisma.repo.findMany({
      where: query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { slug: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        name: true,
        slug: true,
        visibility: true,
        defaultBranch: true,
        createdAt: true,
        workspaceId: true,
      },
    });
    return { repos };
  });

  server.get('/admin/pats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = listQuerySchema.parse(request.query ?? {});
    const pats = await prisma.personalAccessToken.findMany({
      where: query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { tokenPrefix: { contains: query.q, mode: 'insensitive' } },
              {
                user: {
                  OR: [
                    { email: { contains: query.q, mode: 'insensitive' } },
                    { username: { contains: query.q, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : undefined,
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      take: query.limit ?? 100,
      select: {
        id: true,
        userId: true,
        name: true,
        tokenPrefix: true,
        scopes: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            email: true,
            username: true,
          },
        },
      },
    });
    return { pats };
  });

  server.post('/admin/pats/:tokenId/revoke', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const params = z.object({ tokenId: z.string().min(1) }).parse(request.params);
    const existing = await prisma.personalAccessToken.findUnique({
      where: { id: params.tokenId },
      select: { id: true, revokedAt: true },
    });
    if (!existing) {
      return reply.code(404).send({ message: 'Token not found.' });
    }
    if (!existing.revokedAt) {
      await prisma.personalAccessToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
    }
    return { revoked: true };
  });

  server.get('/admin/webhooks', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = webhookListQuerySchema.parse(request.query ?? {});
    const webhooks = await prisma.repoWebhook.findMany({
      where: {
        active: query.active,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        repoId: true,
        name: true,
        url: true,
        active: true,
        events: true,
        lastDeliveryAt: true,
        createdAt: true,
      },
    });
    return { webhooks };
  });

  server.get('/admin/import-jobs', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) {
      return;
    }

    const query = importJobListQuerySchema.parse(request.query ?? {});
    const jobs = await prisma.repoImportJob.findMany({
      where: {
        status: query.status,
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 100,
      select: {
        id: true,
        repoId: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        nextRunAt: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { jobs };
  });
}
