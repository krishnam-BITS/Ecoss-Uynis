import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@uynis/db';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createUserSession } from '../lib/sessions.js';
import { toSlug } from '../lib/slug.js';
import { buildRateLimitKey, enforceRateLimit } from '../lib/rate-limit.js';
import { OtpSendRateLimitError, sendOtpChallenge, verifyOtpChallenge } from '../lib/otp-service.js';

const phoneSchema = z.string().regex(/^\+?[0-9]{7,15}$/);

const signupSchema = z
  .object({
    email: z.string().email().optional(),
    phone: phoneSchema.optional(),
    username: z.string().min(3),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1).optional(),
    dateOfBirth: z.string(),
    gender: z.string().min(1),
    skipVerification: z.boolean().optional(),
  })
  .refine((data) => data.email || data.phone, {
    message: 'Email or phone is required.',
  });

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const sendOtpSchema = z.object({
  identifier: z.string().min(1),
  purpose: z.enum(['ACCOUNT_VERIFY', 'IDENTIFIER_RECOVERY']),
  userId: z.string().min(1).optional(),
});

const privateLoginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(1),
});

const recoverIdentifiersSchema = z.object({
  identifier: z.string().min(1),
  otp: z.string().min(1),
});

const resetPasswordByIdentifierSchema = z.object({
  identifier: z.string().min(1),
  otp: z.string().min(1),
  newPassword: z.string().min(8),
  userId: z.string().min(1).optional(),
});

const resetPasswordByAccountSchema = z.object({
  accountId: z.string().min(1),
  newPassword: z.string().min(8),
});

const resetOptionsSchema = z.object({
  identifier: z.string().min(1),
});

const resetSendSchema = z.object({
  method: z.enum(['email', 'phone']),
  identifier: z.string().min(1),
  accountId: z.string().optional(),
});

const resetOtpSchema = z.object({
  method: z.enum(['email', 'phone']),
  identifier: z.string().min(1),
  otp: z.string().min(1),
  accountId: z.string().optional(),
});

const verifyRecoveryPhraseSchema = z.object({
  recoveryPhrase: z.string().min(1),
});

const resetPrivatePasswordSchema = z.object({
  recoveryPhrase: z.string().min(1),
  newPassword: z.string().min(8),
});

const loginRateLimit = {
  limit: Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT ?? '30', 10),
  windowSeconds: Number.parseInt(process.env.AUTH_LOGIN_RATE_WINDOW_SECONDS ?? '60', 10),
};

const signupRateLimit = {
  limit: Number.parseInt(process.env.AUTH_SIGNUP_RATE_LIMIT ?? '12', 10),
  windowSeconds: Number.parseInt(process.env.AUTH_SIGNUP_RATE_WINDOW_SECONDS ?? '300', 10),
};

function normalizeOtpScopeKey(value: string) {
  return value.trim().toLowerCase();
}

function isEmailIdentifier(value: string) {
  return z.string().email().safeParse(value).success;
}

function isPhoneIdentifier(value: string) {
  return phoneSchema.safeParse(value).success;
}

function getPasswordResetScopeKey(input: {
  method: 'email' | 'phone';
  identifier: string;
  accountId?: string;
}) {
  return `reset:${input.method}:${normalizeOtpScopeKey(input.identifier)}`;
}

async function enforceAuthRateLimit(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  bucket: string;
  identifier?: string | null;
  limit: number;
  windowSeconds: number;
  message: string;
}) {
  const ip = input.request.ip?.trim() || 'unknown-ip';
  const key = buildRateLimitKey([
    'auth',
    input.bucket,
    ip,
    input.identifier?.trim().toLowerCase() || null,
  ]);
  return enforceRateLimit({
    request: input.request,
    reply: input.reply,
    key,
    limit: input.limit,
    windowSeconds: input.windowSeconds,
    message: input.message,
  });
}

function handleOtpSendRateLimit(reply: FastifyReply, error: unknown) {
  if (error instanceof OtpSendRateLimitError) {
    return reply.code(429).send({
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    });
  }
  throw error;
}

function getOtpDeliveryFailureMessage(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message || message.toLowerCase() === 'fetch failed') {
      return 'We could not reach the verification delivery service. Please try again shortly.';
    }
    return message;
  }
  return 'We could not send a verification code right now. Please try again shortly.';
}

const PRIVATE_USERNAME_ADJECTIVES = [
  'silent',
  'swift',
  'hidden',
  'ember',
  'frost',
  'velvet',
  'midnight',
  'silver',
  'amber',
  'cosmic',
  'shadow',
  'arctic',
  'iron',
  'quiet',
  'neon',
  'cobalt',
  'atlas',
  'mystic',
  'urban',
  'nova',
] as const;

const PRIVATE_USERNAME_NOUNS = [
  'fox',
  'falcon',
  'raven',
  'wolf',
  'otter',
  'lynx',
  'harbor',
  'cipher',
  'vortex',
  'pixel',
  'orbit',
  'quartz',
  'trail',
  'signal',
  'comet',
  'echo',
  'dawn',
  'glacier',
  'summit',
  'arc',
] as const;

const PRIVATE_RECOVERY_WORDS = [
  'amber',
  'anchor',
  'april',
  'arrow',
  'atlas',
  'autumn',
  'bamboo',
  'beacon',
  'berry',
  'blossom',
  'breeze',
  'bridge',
  'cactus',
  'candle',
  'canyon',
  'cedar',
  'charm',
  'cloud',
  'coral',
  'crystal',
  'daisy',
  'dawn',
  'delta',
  'drift',
  'ember',
  'fern',
  'flame',
  'forest',
  'frost',
  'galaxy',
  'garden',
  'glow',
  'granite',
  'harbor',
  'horizon',
  'island',
  'jungle',
  'lantern',
  'lavender',
  'meadow',
  'meteor',
  'mint',
  'moon',
  'mountain',
  'nova',
  'oasis',
  'ocean',
  'olive',
  'opal',
  'orchid',
  'pebble',
  'petal',
  'pine',
  'prairie',
  'quartz',
  'raven',
  'reef',
  'river',
  'rose',
  'saffron',
  'sail',
  'shadow',
  'silver',
  'sky',
  'snow',
  'sparrow',
  'spice',
  'sprout',
  'star',
  'stone',
  'sunset',
  'thunder',
  'tide',
  'timber',
  'trail',
  'valley',
  'violet',
  'wave',
  'willow',
  'winter',
  'zenith',
] as const;

function getSessionMaxAgeDays(): number {
  const parsed = Number.parseInt(process.env.AUTH_SESSION_MAX_AGE_DAYS ?? '30', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 30;
  }
  return parsed;
}

function getPrivateAccountExpiryDate(): Date {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
}

function normalizeRecoveryPhrase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function generatePrivateUsername(): string {
  const adjective =
    PRIVATE_USERNAME_ADJECTIVES[randomInt(PRIVATE_USERNAME_ADJECTIVES.length)];
  const noun = PRIVATE_USERNAME_NOUNS[randomInt(PRIVATE_USERNAME_NOUNS.length)];
  const suffix = randomInt(1000, 10000);
  return `${adjective}${noun}${suffix}`;
}

function generatePrivatePassword(length = 14): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()-_=+[]{}';
  const all = `${lower}${upper}${digits}${symbols}`;

  const pick = (chars: string) => chars[randomInt(chars.length)];

  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  for (let index = chars.length; index < length; index += 1) {
    chars.push(pick(all));
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const next = chars[index];
    chars[index] = chars[swapIndex];
    chars[swapIndex] = next;
  }

  return chars.join('');
}

function generateRecoveryPhrase(words = 12): string {
  const selected: string[] = [];
  for (let index = 0; index < words; index += 1) {
    selected.push(PRIVATE_RECOVERY_WORDS[randomInt(PRIVATE_RECOVERY_WORDS.length)]);
  }
  return selected.join(' ');
}

export async function authRoutes(server: FastifyInstance) {
  const maskEmail = (value: string) => {
    const [local, domain] = value.split('@');
    if (!local || !domain) {
      return value;
    }
    const localStart = local.slice(0, 1);
    const localEnd = local.length > 2 ? local.slice(-1) : '';
    const [domainName, ...tldParts] = domain.split('.');
    const tld = tldParts.length ? `.${tldParts.join('.')}` : '';
    const domainStart = domainName.slice(0, 1);
    const domainEnd = domainName.length > 2 ? domainName.slice(-1) : '';
    return `${localStart}****${localEnd}@${domainStart}****${domainEnd}${tld}`;
  };

  const maskPhone = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 4) {
      return value;
    }
    const last = digits.slice(-2);
    const prefix = value.startsWith('+') ? '+' : '';
    const country = digits.length > 10 ? digits.slice(0, digits.length - 10) : '';
    const national = digits.slice(country.length);
    const firstOne = national.slice(0, 1);
    const maskedLen = Math.max(national.length - 3, 4);
    return `${prefix}${country}${firstOne}${'*'.repeat(maskedLen)}${last}`;
  };

  const ensurePersonalWorkspace = async (user: {
    id: string;
    email?: string | null;
    phone?: string | null;
    name?: string | null;
  }) => {
    const existing = await prisma.workspace.findFirst({
      where: { ownerUserId: user.id, isPersonal: true },
      select: { id: true },
    });
    if (existing) {
      return;
    }

    const fallbackName =
      user.email?.split('@')[0] ?? user.phone ?? `user-${user.id.slice(-6)}`;
    const baseName = (user.name ?? fallbackName).trim();
    let slug = toSlug(baseName);
    if (!slug) {
      slug = `user-${user.id.slice(-6)}`;
    }

    const createPersonalWorkspace = async (workspaceSlug: string) =>
      prisma.workspace.create({
        data: {
          name: baseName || user.email || user.phone || `User ${user.id.slice(-6)}`,
          slug: workspaceSlug,
          isPersonal: true,
          ownerUserId: user.id,
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
        },
      });

    try {
      await createPersonalWorkspace(slug);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const fallbackSlug = `${slug}-${user.id.slice(-6)}`;
          await createPersonalWorkspace(fallbackSlug);
          return;
        }
      }
      throw error;
    }
  };

  const issueSessionToken = async (
    request: FastifyRequest,
    user: { id: string; email?: string | null; phone?: string | null; name?: string | null },
  ) => {
    const maxAgeDays = getSessionMaxAgeDays();
    const tokenId = randomUUID();
    const expiresAt = new Date(Date.now() + maxAgeDays * 24 * 60 * 60 * 1000);
    const token = server.jwt.sign(
      {
        sub: user.id,
        email: user.email ?? user.phone ?? user.name ?? user.id,
      },
      {
        jti: tokenId,
        expiresIn: `${maxAgeDays}d`,
      },
    );

    await createUserSession({
      request,
      userId: user.id,
      tokenId,
      expiresAt,
    });

    return token;
  };

  const findPrivateAccountByRecoveryPhrase = async (recoveryPhrase: string) => {
    const normalizedPhrase = normalizeRecoveryPhrase(recoveryPhrase);
    if (!normalizedPhrase) {
      return null;
    }

    const candidates = await prisma.privateAccount.findMany({
      where: {
        status: {
          in: ['ACTIVE', 'ARCHIVED'],
        },
      },
      select: {
        id: true,
        userId: true,
        username: true,
        status: true,
        recoveryPhraseHash: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    for (const candidate of candidates) {
      if (verifyPassword(normalizedPhrase, candidate.recoveryPhraseHash)) {
        return candidate;
      }
    }

    return null;
  };

  const resolveOtpDelivery = async (input: { identifier: string; userId?: string }) => {
    const identifier = input.identifier.trim();
    const emailIdentifier = isEmailIdentifier(identifier);
    const phoneIdentifier = isPhoneIdentifier(identifier);

    const user = input.userId
      ? await prisma.user.findFirst({
          where: {
            id: input.userId,
            OR: [{ email: identifier }, { phone: identifier }, { username: identifier }],
          },
          select: { id: true, email: true, phone: true, username: true },
        })
      : await prisma.user.findFirst({
          where: emailIdentifier
            ? { email: identifier }
            : phoneIdentifier
              ? { phone: identifier }
              : { username: identifier },
          select: { id: true, email: true, phone: true, username: true },
        });

    if (!user) {
      return null;
    }

    if (emailIdentifier) {
      return {
        channel: 'email' as const,
        recipient: identifier,
      };
    }

    if (phoneIdentifier) {
      return {
        channel: 'phone' as const,
        recipient: identifier,
      };
    }

    if (user.email) {
      return {
        channel: 'email' as const,
        recipient: user.email,
      };
    }

    if (user.phone) {
      return {
        channel: 'phone' as const,
        recipient: user.phone,
      };
    }

    return null;
  };

  const sendIdentifierOtp = async (input: {
    identifier: string;
    purpose: 'ACCOUNT_VERIFY' | 'IDENTIFIER_RECOVERY';
    userId?: string;
  }) => {
    const delivery = await resolveOtpDelivery(input);
    if (!delivery) {
      return {
        sent: false,
        delivery: null,
      };
    }

    const challenge = await sendOtpChallenge({
      purpose: input.purpose,
      scopeKey: normalizeOtpScopeKey(input.identifier),
      channel: delivery.channel,
      recipient: delivery.recipient,
    });
    return {
      sent: true,
      delivery: challenge.delivery,
    };
  };

  server.post('/auth/signup', async (request, reply) => {
    const signupAllowed = await enforceAuthRateLimit({
      request,
      reply,
      bucket: 'signup',
      limit: signupRateLimit.limit,
      windowSeconds: signupRateLimit.windowSeconds,
      message: 'Too many signup attempts. Try again later.',
    });
    if (!signupAllowed) {
      return;
    }

    const body = signupSchema.parse(request.body);
    const parsedDateOfBirth = new Date(body.dateOfBirth);
    if (Number.isNaN(parsedDateOfBirth.valueOf())) {
      return reply.code(400).send({ message: 'Invalid date of birth.' });
    }

    if (body.skipVerification) {
      if (!body.phone) {
        return reply.code(400).send({ message: 'Phone verification required.' });
      }
      const verifiedPhone = await prisma.user.findFirst({
        where: { phone: body.phone, phoneVerified: true },
        select: { id: true },
      });
      if (!verifiedPhone) {
        return reply.code(403).send({ message: 'Phone verification required.' });
      }
    }

    if (body.email) {
      const existing = await prisma.user.findUnique({
        where: { email: body.email },
      });
      if (existing) {
        return reply.code(409).send({ message: 'Email already in use.' });
      }
    }
    const existingUsername = await prisma.user.findUnique({
      where: { username: body.username },
    });
    if (existingUsername) {
      return reply.code(409).send({ message: 'Username already in use.' });
    }

    const user = await prisma.$transaction(async (tx) => {
      const displayName = [body.firstName, body.lastName].filter(Boolean).join(' ');
      const verificationExpiresAt = body.skipVerification
        ? null
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const emailVerified = false;
      const phoneVerified = body.skipVerification ? true : false;
      const isVerified = phoneVerified;
      const createdUser = await tx.user.create({
        data: {
          email: body.email,
          phone: body.phone,
          username: body.username,
          passwordHash: hashPassword(body.password),
          name: displayName || body.email?.split('@')[0] || body.phone || body.username,
          firstName: body.firstName,
          lastName: body.lastName,
          dateOfBirth: parsedDateOfBirth,
          gender: body.gender,
          isVerified,
          verificationExpiresAt,
          emailVerified,
          phoneVerified,
        },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
        },
      });

      const baseName =
        displayName || body.email?.split('@')[0].trim() || body.phone || body.username;
      let slug = toSlug(baseName);
      if (!slug) {
        slug = `user-${createdUser.id.slice(-6)}`;
      }

      const existingSlug = await tx.workspace.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (existingSlug) {
        slug = `${slug}-${createdUser.id.slice(-6)}`;
      }

      await tx.workspace.create({
        data: {
          name: baseName || createdUser.email || createdUser.phone || createdUser.name,
          slug,
          isPersonal: true,
          ownerUserId: createdUser.id,
          members: {
            create: {
              userId: createdUser.id,
              role: 'OWNER',
            },
          },
        },
      });

      return createdUser;
    });

    if (!body.skipVerification) {
      const identifier = body.email ?? body.phone;
      if (identifier) {
        try {
          const otpResult = await sendIdentifierOtp({
            identifier,
            purpose: 'ACCOUNT_VERIFY',
            userId: user.id,
          });
          if (
            otpResult.sent &&
            otpResult.delivery &&
            !otpResult.delivery.delivered
          ) {
            return reply
              .code(201)
              .send({
                user,
                pendingVerification: true,
                otpSent: false,
                deliveryIssue: true,
                message:
                  'Your account was created, but we could not confirm delivery of the verification code. Try logging in again later to resend it.',
              });
          }
        } catch (error) {
          if (error instanceof OtpSendRateLimitError) {
            return handleOtpSendRateLimit(reply, error);
          }
          return reply.code(201).send({
            user,
            pendingVerification: true,
            otpSent: false,
            deliveryIssue: true,
            message:
              'Your account was created, but we could not send the verification code right now. Try logging in again later to resend it.',
          });
        }
      }
    }

    return reply
      .code(201)
      .send({ user, pendingVerification: !body.skipVerification, otpSent: !body.skipVerification });
  });

  server.post('/auth/check-identifier', async (request, reply) => {
    const body = z
      .object({
        identifier: z.string().min(1),
      })
      .parse(request.body);
    const isEmail = z.string().email().safeParse(body.identifier).success;
    const isPhone = phoneSchema.safeParse(body.identifier).success;
    if (!isEmail && !isPhone) {
      return reply.code(400).send({ message: 'Invalid email or phone.' });
    }
    const existing = await prisma.user.findFirst({
      where: isEmail ? { email: body.identifier } : { phone: body.identifier },
      select: { id: true, isVerified: true },
    });
    return reply.send({ exists: Boolean(existing), verified: existing?.isVerified ?? false });
  });

  server.post('/auth/check-username', async (request, reply) => {
    const body = z.object({ username: z.string().min(4) }).parse(request.body);
    const existing = await prisma.user.findUnique({
      where: { username: body.username },
      select: { id: true, isVerified: true },
    });
    return reply.send({ exists: Boolean(existing), verified: existing?.isVerified ?? false });
  });

  server.post('/auth/phone-accounts', async (request, reply) => {
    const body = z
      .object({
        phone: phoneSchema,
      })
      .parse(request.body);

    const accounts = await prisma.user.findMany({
      where: { phone: body.phone },
      select: { id: true, email: true, username: true },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        username: account.username,
      })),
    });
  });

  server.post('/auth/identifier-accounts', async (request, reply) => {
    const body = z
      .object({
        identifier: z.string().min(1),
      })
      .parse(request.body);

    const isEmail = z.string().email().safeParse(body.identifier).success;
    const isPhone = phoneSchema.safeParse(body.identifier).success;
    if (!isEmail && !isPhone) {
      return reply.code(400).send({ message: 'Invalid email or phone.' });
    }

    const accounts = await prisma.user.findMany({
      where: isEmail ? { email: body.identifier } : { phone: body.identifier },
      select: { id: true, email: true, username: true },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({
      accounts: accounts.map((account) => ({
        id: account.id,
        email: account.email,
        username: account.username,
      })),
    });
  });

  server.post('/auth/send-otp', async (request, reply) => {
    const body = sendOtpSchema.parse(request.body);
    let sent = false;
    let delivered = false;
    try {
      const otpResult = await sendIdentifierOtp({
        identifier: body.identifier,
        purpose: body.purpose,
        userId: body.userId,
      });
      sent = otpResult.sent;
      delivered = Boolean(otpResult.delivery?.delivered);
    } catch (error) {
      if (error instanceof OtpSendRateLimitError) {
        return handleOtpSendRateLimit(reply, error);
      }
      return reply.code(503).send({
        message: getOtpDeliveryFailureMessage(error),
        sent: false,
        deliveryIssue: true,
      });
    }

    if (!sent) {
      return reply.code(404).send({ message: 'Account not found or no delivery channel is available.' });
    }

    if (!delivered) {
      return reply.code(503).send({
        message: 'We could not confirm delivery of the verification code. Please try again shortly.',
        sent: false,
        deliveryIssue: true,
      });
    }

    return reply.send({ sent: true });
  });

  server.post('/auth/verify-otp', async (request, reply) => {
    const body = z
      .object({
        identifier: z.string().min(1),
        otp: z.string().min(1),
        userId: z.string().min(1).optional(),
        purpose: z.enum(['ACCOUNT_VERIFY', 'IDENTIFIER_RECOVERY']).optional(),
      })
      .parse(request.body);

    const purpose = body.purpose ?? 'ACCOUNT_VERIFY';
    const verified = verifyOtpChallenge({
      purpose,
      scopeKey: normalizeOtpScopeKey(body.identifier),
      code: body.otp,
    });

    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    if (purpose === 'IDENTIFIER_RECOVERY') {
      return reply.send({ verified: true, recovery: true });
    }

    const identifierWhere: Prisma.UserWhereInput = {
      OR: [{ email: body.identifier }, { phone: body.identifier }, { username: body.identifier }],
    };

    const emailIdentifier = isEmailIdentifier(body.identifier);
    const phoneIdentifier = isPhoneIdentifier(body.identifier);
    const now = new Date();

    if (body.userId) {
      const selectedUser = await prisma.user.findFirst({
        where: {
          AND: [{ id: body.userId }, identifierWhere],
        },
        select: { id: true, verificationExpiresAt: true },
      });

      if (!selectedUser) {
        return reply.code(404).send({ message: 'Account not found for this OTP verification.' });
      }

      if (selectedUser.verificationExpiresAt && selectedUser.verificationExpiresAt < now) {
        return reply.code(410).send({ message: 'Verification expired. Please sign up again.' });
      }

      await prisma.user.update({
        where: { id: selectedUser.id },
        data: {
          isVerified: true,
          verificationExpiresAt: null,
          ...(emailIdentifier
            ? {
                emailVerified: true,
                emailVerificationExpiresAt: null,
              }
            : {}),
          ...(phoneIdentifier
            ? {
                phoneVerified: true,
                phoneVerificationExpiresAt: null,
              }
            : {}),
        },
      });

      return reply.send({ verified: true, count: 1 });
    }

    const matches = await prisma.user.findMany({
      where: identifierWhere,
      select: { id: true, verificationExpiresAt: true },
    });

    if (!matches.length) {
      return reply.code(404).send({ message: 'Account not found for this OTP verification.' });
    }

    const eligibleIds = matches
      .filter((candidate) => !candidate.verificationExpiresAt || candidate.verificationExpiresAt >= now)
      .map((candidate) => candidate.id);

    if (!eligibleIds.length) {
      return reply.code(410).send({ message: 'Verification expired. Please sign up again.' });
    }

    await prisma.user.updateMany({
      where: { id: { in: eligibleIds } },
      data: {
        isVerified: true,
        verificationExpiresAt: null,
        ...(emailIdentifier
          ? {
              emailVerified: true,
              emailVerificationExpiresAt: null,
            }
          : {}),
        ...(phoneIdentifier
          ? {
              phoneVerified: true,
              phoneVerificationExpiresAt: null,
            }
          : {}),
      },
    });

    return reply.send({ verified: true, count: eligibleIds.length });
  });

  server.post('/auth/reset-options', async (request, reply) => {
    const body = resetOptionsSchema.parse(request.body);
    const isEmail = z.string().email().safeParse(body.identifier).success;
    const isPhone = phoneSchema.safeParse(body.identifier).success;

    if (isPhone) {
      return reply.code(400).send({ message: 'Phone flow requires OTP first.' });
    }

    const user = await prisma.user.findFirst({
      where: isEmail ? { email: body.identifier } : { username: body.identifier },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' });
    }

    const privateAccount = await prisma.privateAccount.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });

    return reply.send({
      accountId: user.id,
      username: user.username,
      email: user.email ?? null,
      phone: user.phone ?? null,
      hasEmail: Boolean(user.email),
      hasPhone: Boolean(user.phone),
      emailMasked: user.email ? maskEmail(user.email) : null,
      phoneMasked: user.phone ? maskPhone(user.phone) : null,
      isPrivateAccount: Boolean(privateAccount),
    });
  });

  server.post('/auth/send-reset-otp', async (request, reply) => {
    const body = resetSendSchema.parse(request.body);

    if (body.accountId) {
      const user = await prisma.user.findUnique({
        where: { id: body.accountId },
        select: { id: true, email: true, phone: true },
      });
      if (!user) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'email' && user.email !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'phone' && user.phone !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      try {
        await sendOtpChallenge({
          purpose: 'PASSWORD_RESET',
          scopeKey: getPasswordResetScopeKey({
            method: body.method,
            identifier: body.identifier,
            accountId: user.id,
          }),
          channel: body.method,
          recipient: body.identifier,
        });
      } catch (error) {
        return handleOtpSendRateLimit(reply, error);
      }
      return reply.send({ sent: true });
    }

    const user = await prisma.user.findFirst({
      where: body.method === 'email' ? { email: body.identifier } : { phone: body.identifier },
      select: { id: true },
    });

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' });
    }

    try {
      await sendOtpChallenge({
        purpose: 'PASSWORD_RESET',
        scopeKey: getPasswordResetScopeKey(body),
        channel: body.method,
        recipient: body.identifier,
      });
    } catch (error) {
      return handleOtpSendRateLimit(reply, error);
    }

    return reply.send({ sent: true });
  });

  server.post('/auth/verify-reset-otp', async (request, reply) => {
    const body = resetOtpSchema.parse(request.body);
    const verified = verifyOtpChallenge({
      purpose: 'PASSWORD_RESET',
      scopeKey: getPasswordResetScopeKey(body),
      code: body.otp,
    }, { consume: false });
    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    if (body.accountId) {
      const user = await prisma.user.findUnique({
        where: { id: body.accountId },
        select: { id: true, email: true, phone: true },
      });
      if (!user) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'email' && user.email !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'phone' && user.phone !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetRequired: true },
      });
      return reply.send({ verified: true, accountId: user.id });
    }

    const user = await prisma.user.findFirst({
      where: body.method === 'email' ? { email: body.identifier } : { phone: body.identifier },
      select: { id: true },
    });
    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordResetRequired: true },
    });

    return reply.send({ verified: true, accountId: user.id });
  });

  server.post('/auth/login-with-otp', async (request, reply) => {
    const body = resetOtpSchema.parse(request.body);
    const verified = verifyOtpChallenge({
      purpose: 'PASSWORD_RESET',
      scopeKey: getPasswordResetScopeKey(body),
      code: body.otp,
    });
    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    let user:
      | { id: string; email: string | null; phone: string | null; name: string | null; username: string | null }
      | null = null;

    if (body.accountId) {
      const selected = await prisma.user.findUnique({
        where: { id: body.accountId },
        select: { id: true, email: true, phone: true, username: true, name: true },
      });
      if (!selected) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'email' && selected.email !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      if (body.method === 'phone' && selected.phone !== body.identifier) {
        return reply.code(404).send({ message: 'Account not found.' });
      }
      user = selected;
    } else {
      user = await prisma.user.findFirst({
        where: body.method === 'email' ? { email: body.identifier } : { phone: body.identifier },
        select: { id: true, email: true, phone: true, username: true, name: true },
      });
    }

    if (!user) {
      return reply.code(404).send({ message: 'Account not found.' });
    }

    await ensurePersonalWorkspace(user);
    const token = await issueSessionToken(request, user);
    return reply.send({ token });
  });

  server.post('/auth/recover-identifiers', async (request, reply) => {
    const body = recoverIdentifiersSchema.parse(request.body);
    const verified = verifyOtpChallenge({
      purpose: 'IDENTIFIER_RECOVERY',
      scopeKey: normalizeOtpScopeKey(body.identifier),
      code: body.otp,
    });
    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: body.identifier },
          { phone: body.identifier },
          { username: body.identifier },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        name: true,
        privateAccount: {
          select: {
            status: true,
          },
        },
      },
    });

    if (!users.length) {
      return reply.code(404).send({ message: 'No accounts found for this identifier.' });
    }

    const accounts = users
      .filter((user) => user.privateAccount?.status !== 'DELETED')
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        name: user.name,
        privateAccountStatus: user.privateAccount?.status ?? null,
      }));

    return reply.send({ accounts });
  });

  server.post('/auth/reset-password', async (request, reply) => {
    const parsed = z
      .union([resetPasswordByIdentifierSchema, resetPasswordByAccountSchema])
      .parse(request.body);

    if ('accountId' in parsed) {
      const user = await prisma.user.findUnique({
        where: { id: parsed.accountId },
        select: {
          id: true,
          privateAccount: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!user) {
        return reply.code(404).send({ message: 'Account not found.' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: hashPassword(parsed.newPassword),
            passwordChangedAt: new Date(),
            passwordResetRequired: false,
          },
        });

        if (user.privateAccount) {
          await tx.privateAccount.update({
            where: { userId: user.id },
            data: {
              passwordHash: hashPassword(parsed.newPassword),
              status: 'ACTIVE',
              archivedAt: null,
              deletedAt: null,
              lastLoginAt: new Date(),
              expiresAt: getPrivateAccountExpiryDate(),
            },
          });
        }
      });

      const authUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, phone: true, name: true },
      });
      if (!authUser) {
        return reply.code(404).send({ message: 'Account not found.' });
      }

      await ensurePersonalWorkspace(authUser);
      const token = await issueSessionToken(request, authUser);
      return reply.send({ token });
    }

    const body = parsed;
    const verified =
      verifyOtpChallenge({
        purpose: 'PASSWORD_RESET',
        scopeKey: getPasswordResetScopeKey({
          method: 'email',
          identifier: body.identifier,
          accountId: body.userId,
        }),
        code: body.otp,
      }) ||
      verifyOtpChallenge({
        purpose: 'PASSWORD_RESET',
        scopeKey: getPasswordResetScopeKey({
          method: 'phone',
          identifier: body.identifier,
          accountId: body.userId,
        }),
        code: body.otp,
      }) ||
      verifyOtpChallenge({
        purpose: 'PASSWORD_RESET',
        scopeKey: normalizeOtpScopeKey(body.identifier),
        code: body.otp,
      });
    if (!verified) {
      return reply.code(400).send({ message: 'Invalid OTP.' });
    }

    const matches = await prisma.user.findMany({
      where: {
        OR: [
          { email: body.identifier },
          { phone: body.identifier },
          { username: body.identifier },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        privateAccount: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!matches.length) {
      return reply.code(404).send({ message: 'Account not found.' });
    }

    let targetUser = matches[0];
    if (matches.length > 1) {
      if (!body.userId) {
        return reply.code(409).send({
          message: 'Multiple accounts found. Select an account to continue.',
          requiresAccountSelection: true,
          accounts: matches.map((user) => ({
            id: user.id,
            username: user.username,
            email: user.email,
            phone: user.phone,
          })),
        });
      }

      const selected = matches.find((user) => user.id === body.userId);
      if (!selected) {
        return reply.code(404).send({ message: 'Selected account not found.' });
      }
      targetUser = selected;
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: targetUser.id },
        data: {
          passwordHash: hashPassword(body.newPassword),
          passwordChangedAt: new Date(),
          passwordResetRequired: false,
        },
      });

      if (targetUser.privateAccount) {
        await tx.privateAccount.update({
          where: { userId: targetUser.id },
          data: {
            passwordHash: hashPassword(body.newPassword),
            status: 'ACTIVE',
            archivedAt: null,
            deletedAt: null,
            lastLoginAt: new Date(),
            expiresAt: getPrivateAccountExpiryDate(),
          },
        });
      }
    });

    return reply.send({ ok: true });
  });

  server.post('/auth/private/create', async (request, reply) => {
    const body = z
      .object({
        username: z
          .string()
          .trim()
          .min(4)
          .max(64)
          .regex(/^[A-Za-z0-9._-]+$/)
          .optional(),
        password: z.string().min(8).max(256).optional(),
        recoveryPhrase: z.string().min(10).max(400).optional(),
      })
      .passthrough()
      .parse(request.body ?? {});

    const hasProvidedCredentials =
      Boolean(body.username) || Boolean(body.password) || Boolean(body.recoveryPhrase);

    if (
      hasProvidedCredentials &&
      (!body.username || !body.password || !body.recoveryPhrase)
    ) {
      return reply.code(400).send({
        message: 'Username, password, and recovery phrase are required together.',
      });
    }

    let createdUser:
      | {
          id: string;
          email: string | null;
          phone: string | null;
          name: string | null;
          username: string | null;
        }
      | null = null;
    let credentials: { username: string; password: string; recoveryPhrase: string } | null = null;

    const providedCredentials =
      hasProvidedCredentials && body.username && body.password && body.recoveryPhrase
        ? {
            username: body.username,
            password: body.password,
            recoveryPhrase: body.recoveryPhrase.trim().replace(/\s+/g, ' '),
          }
        : null;

    const attempts = providedCredentials ? 1 : 10;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const username = providedCredentials?.username ?? generatePrivateUsername();
      const password = providedCredentials?.password ?? generatePrivatePassword();
      const recoveryPhrase = providedCredentials?.recoveryPhrase ?? generateRecoveryPhrase();
      const normalizedPhrase = normalizeRecoveryPhrase(recoveryPhrase);

      const existing = await prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (existing) {
        if (providedCredentials) {
          return reply.code(409).send({ message: 'Username already taken.' });
        }
        continue;
      }

      try {
        createdUser = await prisma.$transaction(async (tx) => {
          const passwordHash = hashPassword(password);
          const created = await tx.user.create({
            data: {
              username,
              name: username,
              passwordHash,
              isVerified: true,
              emailVerified: false,
              phoneVerified: false,
            },
            select: {
              id: true,
              email: true,
              phone: true,
              name: true,
              username: true,
            },
          });

          let workspaceSlug = toSlug(username);
          if (!workspaceSlug) {
            workspaceSlug = `user-${created.id.slice(-6)}`;
          }

          const existingWorkspace = await tx.workspace.findUnique({
            where: { slug: workspaceSlug },
            select: { id: true },
          });
          if (existingWorkspace) {
            workspaceSlug = `${workspaceSlug}-${created.id.slice(-6)}`;
          }

          await tx.workspace.create({
            data: {
              name: username,
              slug: workspaceSlug,
              isPersonal: true,
              ownerUserId: created.id,
              members: {
                create: {
                  userId: created.id,
                  role: 'OWNER',
                },
              },
            },
          });

          await tx.privateAccount.create({
            data: {
              userId: created.id,
              username,
              passwordHash,
              recoveryPhrase: null,
              recoveryPhraseHash: hashPassword(normalizedPhrase),
              status: 'ACTIVE',
              expiresAt: getPrivateAccountExpiryDate(),
              lastLoginAt: new Date(),
            },
          });

          return created;
        });

        credentials = {
          username,
          password,
          recoveryPhrase,
        };
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          if (providedCredentials) {
            return reply.code(409).send({ message: 'Username already taken.' });
          }
          continue;
        }
        throw error;
      }
    }

    if (!createdUser || !credentials) {
      return reply.code(500).send({ message: 'Unable to create private account. Try again.' });
    }

    const token = await issueSessionToken(request, createdUser);

    return reply.code(201).send({
      token,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        name: createdUser.name,
        username: createdUser.username,
      },
      privateAccount: {
        username: credentials.username,
        password: credentials.password,
        recoveryPhrase: credentials.recoveryPhrase,
        expiresAt: getPrivateAccountExpiryDate().toISOString(),
      },
    });
  });

  server.post('/auth/private/login', async (request, reply) => {
    const privateLoginAllowed = await enforceAuthRateLimit({
      request,
      reply,
      bucket: 'private-login',
      limit: loginRateLimit.limit,
      windowSeconds: loginRateLimit.windowSeconds,
      message: 'Too many login attempts. Try again shortly.',
    });
    if (!privateLoginAllowed) {
      return;
    }

    const body = privateLoginSchema.parse(request.body);

    const privateAccount = await prisma.privateAccount.findUnique({
      where: { username: body.username },
      select: {
        id: true,
        userId: true,
        status: true,
        passwordHash: true,
        user: {
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!privateAccount) {
      return reply.code(401).send({ message: 'Invalid credentials.' });
    }
    if (privateAccount.status !== 'ACTIVE') {
      return reply.code(403).send({ message: 'Private account is not active.' });
    }
    if (!verifyPassword(body.password, privateAccount.passwordHash)) {
      return reply.code(401).send({ message: 'Invalid credentials.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.privateAccount.update({
        where: { id: privateAccount.id },
        data: {
          lastLoginAt: new Date(),
          expiresAt: getPrivateAccountExpiryDate(),
        },
      });
      await tx.user.update({
        where: { id: privateAccount.userId },
        data: {
          isVerified: true,
        },
      });
    });

    await ensurePersonalWorkspace(privateAccount.user);

    const token = await issueSessionToken(request, privateAccount.user);

    return reply.send({
      token,
      user: {
        id: privateAccount.user.id,
        email: privateAccount.user.email,
        name: privateAccount.user.name,
      },
    });
  });

  server.post('/auth/verify-recovery-phrase', async (request, reply) => {
    const body = verifyRecoveryPhraseSchema.parse(request.body);

    const privateAccount = await findPrivateAccountByRecoveryPhrase(body.recoveryPhrase);
    if (!privateAccount) {
      return reply.code(404).send({ message: 'Recovery phrase is invalid.' });
    }

    return reply.send({
      accountId: privateAccount.id,
      username: privateAccount.username,
      userId: privateAccount.userId,
      status: privateAccount.status,
    });
  });

  server.post('/auth/reset-private-password', async (request, reply) => {
    const body = resetPrivatePasswordSchema.parse(request.body);

    const privateAccount = await findPrivateAccountByRecoveryPhrase(body.recoveryPhrase);
    if (!privateAccount) {
      return reply.code(404).send({ message: 'Recovery phrase is invalid.' });
    }
    if (privateAccount.status === 'DELETED') {
      return reply.code(410).send({ message: 'Private account has been deleted.' });
    }

    const nextPasswordHash = hashPassword(body.newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.privateAccount.update({
        where: { id: privateAccount.id },
        data: {
          passwordHash: nextPasswordHash,
          status: 'ACTIVE',
          archivedAt: null,
          deletedAt: null,
          lastLoginAt: new Date(),
          expiresAt: getPrivateAccountExpiryDate(),
        },
      });

      await tx.user.update({
        where: { id: privateAccount.userId },
        data: {
          passwordHash: nextPasswordHash,
          passwordChangedAt: new Date(),
          isVerified: true,
        },
      });
    });

    await ensurePersonalWorkspace(privateAccount.user);
    const token = await issueSessionToken(request, privateAccount.user);

    return reply.send({ token });
  });

  server.post('/auth/private/archive', async (request, reply) => {
    await request.jwtVerify();

    const account = await prisma.privateAccount.findUnique({
      where: { userId: request.user.sub },
      select: { id: true, status: true },
    });
    if (!account) {
      return reply.code(404).send({ message: 'Private account not found.' });
    }
    if (account.status !== 'ACTIVE') {
      return reply.code(400).send({ message: 'Only active private accounts can be archived.' });
    }

    await prisma.privateAccount.update({
      where: { id: account.id },
      data: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
      },
    });

    return reply.send({ ok: true });
  });

  server.post('/auth/private/delete', async (request, reply) => {
    await request.jwtVerify();

    const account = await prisma.privateAccount.findUnique({
      where: { userId: request.user.sub },
      select: { id: true, status: true },
    });
    if (!account) {
      return reply.code(404).send({ message: 'Private account not found.' });
    }

    await prisma.privateAccount.update({
      where: { id: account.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
      },
    });

    return reply.send({ ok: true });
  });

  server.post('/auth/username-suggestions', async (request, reply) => {
    const body = z
      .object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
      })
      .parse(request.body);

    const rawFirst = (body.firstName ?? '').trim();
    const rawLast = (body.lastName ?? '').trim();
    const baseFromEmail = body.email ? body.email.split('@')[0] : '';
    const first = toSlug(rawFirst);
    const last = toSlug(rawLast);
    const fallback = toSlug(baseFromEmail) || 'uynis';
    const candidates: string[] = [];

    if (first && last) {
      candidates.push(`${first}.${last}`);
      candidates.push(`${first}${last}`);
      candidates.push(`${first}_${last}`);
      candidates.push(`${first[0]}${last}`);
      candidates.push(`${first}${last[0]}`);
    } else if (first) {
      candidates.push(first);
      candidates.push(`${first}x`);
      candidates.push(`${first}_dev`);
      candidates.push(`${first}_hq`);
    } else if (last) {
      candidates.push(last);
      candidates.push(`${last}x`);
    } else {
      candidates.push(fallback);
      candidates.push(`${fallback}hq`);
      candidates.push(`${fallback}desk`);
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    const expanded: string[] = [];
    for (const candidate of uniqueCandidates) {
      expanded.push(candidate);
      expanded.push(`${candidate}${Math.floor(Math.random() * 90) + 10}`);
    }
    const pool = Array.from(new Set(expanded)).slice(0, 20);

    const existing = await prisma.user.findMany({
      where: { username: { in: pool } },
      select: { username: true },
    });
    const taken = new Set(existing.map((item) => item.username).filter(Boolean));
    const suggestions = pool
      .filter((item) => item.length >= 4 && !taken.has(item))
      .slice(0, 2);

    return reply.send({ suggestions });
  });

  server.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const loginAllowed = await enforceAuthRateLimit({
      request,
      reply,
      bucket: 'login',
      identifier: body.identifier,
      limit: loginRateLimit.limit,
      windowSeconds: loginRateLimit.windowSeconds,
      message: 'Too many login attempts. Try again shortly.',
    });
    if (!loginAllowed) {
      return;
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: body.identifier },
          { phone: body.identifier },
          { username: body.identifier },
        ],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        passwordHash: true,
        isVerified: true,
        privateAccount: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      return reply.code(401).send({ message: 'Invalid credentials.' });
    }
    if (!verifyPassword(body.password, user.passwordHash)) {
      return reply.code(401).send({ message: 'Invalid credentials.' });
    }
    if (user.privateAccount && user.privateAccount.status !== 'ACTIVE') {
      return reply.code(403).send({ message: 'Private account is not active.' });
    }
    if (!user.isVerified) {
      return reply
        .code(403)
        .send({ message: 'Account requires verification.', requiresVerification: true });
    }

    await ensurePersonalWorkspace(user);

    if (user.privateAccount) {
      await prisma.privateAccount.update({
        where: { id: user.privateAccount.id },
        data: {
          lastLoginAt: new Date(),
          expiresAt: getPrivateAccountExpiryDate(),
        },
      });
    }

    const token = await issueSessionToken(request, user);

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  });
}
