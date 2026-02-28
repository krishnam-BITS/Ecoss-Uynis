import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@uynis/db';

const tokenPrefix = 'uynis_pat_';
const hashSecret =
  process.env.PAT_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';

export type PersonalAccessTokenRecord = {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function generatePersonalAccessToken(): string {
  const raw = randomBytes(32).toString('base64url');
  return `${tokenPrefix}${raw}`;
}

export function hashPersonalAccessToken(token: string): string {
  return createHmac('sha256', hashSecret).update(token).digest('hex');
}

export function isPersonalAccessToken(value: string): boolean {
  return value.startsWith(tokenPrefix);
}

export function getTokenPrefix(token: string): string {
  if (!token.startsWith(tokenPrefix)) {
    return token.slice(0, 12);
  }
  const suffix = token.slice(tokenPrefix.length);
  return `${tokenPrefix}${suffix.slice(0, 8)}`;
}

export async function createPersonalAccessToken(input: {
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}) {
  const token = generatePersonalAccessToken();
  const tokenHash = hashPersonalAccessToken(token);
  const tokenPrefix = getTokenPrefix(token);

  const record = await prisma.personalAccessToken.create({
    data: {
      userId: input.userId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      scopes: input.scopes ?? [],
      expiresAt: input.expiresAt ?? null,
    },
    select: {
      id: true,
      userId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  return { token, record };
}

export async function findPersonalAccessToken(token: string) {
  const tokenHash = hashPersonalAccessToken(token);
  return prisma.personalAccessToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });
}

export function isTokenActive(token: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): boolean {
  if (token.revokedAt) {
    return false;
  }
  if (token.expiresAt && token.expiresAt < new Date()) {
    return false;
  }
  return true;
}

export async function touchPersonalAccessToken(tokenId: string) {
  await prisma.personalAccessToken.update({
    where: { id: tokenId },
    data: { lastUsedAt: new Date() },
  });
}