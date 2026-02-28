import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@uynis/db';

const secretPrefix = 'uynis_wh_';
const secretHashKey =
  process.env.WEBHOOK_SECRET_KEY ??
  process.env.JWT_SECRET ??
  'dev-secret-change-me';

export function generateWebhookSecret(): string {
  const raw = randomBytes(32).toString('base64url');
  return `${secretPrefix}${raw}`;
}

export function hashWebhookSecret(secret: string): string {
  return createHmac('sha256', secretHashKey).update(secret).digest('hex');
}

export function signWebhookPayload(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function upsertWebhookSecret(repoId: string) {
  const secret = generateWebhookSecret();

  const record = await prisma.repoWebhookSecret.upsert({
    where: { repoId },
    create: {
      repoId,
      // NOTE: field name remains secretHash for backward schema compatibility.
      // We now store the raw secret value so webhook delivery can sign payloads
      // with the same secret shared with webhook consumers.
      secretHash: secret,
    },
    update: {
      secretHash: secret,
    },
    select: {
      id: true,
      repoId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return { secret, record };
}

export async function getWebhookSecretHash(repoId: string) {
  return prisma.repoWebhookSecret.findUnique({
    where: { repoId },
    select: {
      secretHash: true,
    },
  });
}
