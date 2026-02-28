import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@uynis/db';

const tokenPrefix = 'uynis_hook_';
const hashSecret =
  process.env.AUTOMATION_TOKEN_SECRET ??
  process.env.JWT_SECRET ??
  'dev-secret-change-me';

export function generateAutomationToken(): string {
  const raw = randomBytes(32).toString('base64url');
  return `${tokenPrefix}${raw}`;
}

export function hashAutomationToken(token: string): string {
  return createHmac('sha256', hashSecret).update(token).digest('hex');
}

export function getAutomationTokenPrefix(token: string): string {
  if (!token.startsWith(tokenPrefix)) {
    return token.slice(0, 12);
  }
  const suffix = token.slice(tokenPrefix.length);
  return `${tokenPrefix}${suffix.slice(0, 8)}`;
}

export function normalizeAutomationScopes(scopes?: string[]): string[] {
  if (!scopes?.length) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of scopes) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export async function createRepoAutomationToken(input: {
  repoId: string;
  name: string;
  scopes?: string[];
}) {
  const token = generateAutomationToken();
  const tokenHash = hashAutomationToken(token);
  const tokenPrefix = getAutomationTokenPrefix(token);
  const scopes = normalizeAutomationScopes(input.scopes);

  const record = await prisma.repoAutomationToken.create({
    data: {
      repoId: input.repoId,
      name: input.name,
      tokenHash,
      tokenPrefix,
      scopes,
    },
    select: {
      id: true,
      repoId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return { token, record };
}

export async function findRepoAutomationToken(token: string) {
  const tokenHash = hashAutomationToken(token);
  return prisma.repoAutomationToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      repoId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      updatedAt: true,
      repo: {
        select: {
          id: true,
          slug: true,
          workspace: {
            select: {
              id: true,
              slug: true,
            },
          },
        },
      },
    },
  });
}

export function isAutomationTokenActive(token: {
  revokedAt: Date | null;
}): boolean {
  return !token.revokedAt;
}

export async function touchRepoAutomationToken(tokenId: string) {
  await prisma.repoAutomationToken.update({
    where: { id: tokenId },
    data: { lastUsedAt: new Date() },
  });
}
