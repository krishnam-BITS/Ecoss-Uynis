import { createHmac } from 'node:crypto';
import { prisma } from '@uynis/db';

const tokenPrefix = 'uynis_pat_';
const patHashSecret =
  process.env.PAT_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret-change-me';

export type GitPersonalAccessToken = {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
};

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.startsWith('Basic ')) {
    return null;
  }
  try {
    const decoded = Buffer.from(value.slice(6), 'base64').toString('utf8');
    const [username = '', password = ''] = decoded.split(':');
    return { username, password };
  } catch {
    return null;
  }
}

function hashPersonalAccessToken(token: string) {
  return createHmac('sha256', patHashSecret).update(token).digest('hex');
}

export function isPersonalAccessToken(value: string) {
  return value.startsWith(tokenPrefix);
}

export function extractAuthTokenCandidate(authorizationHeader: string | undefined) {
  if (!authorizationHeader) {
    return null;
  }

  if (authorizationHeader.startsWith('Bearer ')) {
    const bearerToken = authorizationHeader.slice('Bearer '.length).trim();
    return bearerToken || null;
  }

  if (authorizationHeader.startsWith('Basic ')) {
    const decoded = decodeBasicAuth(authorizationHeader);
    if (!decoded) {
      return null;
    }
    if (decoded.password) {
      return decoded.password.trim();
    }
    if (decoded.username) {
      return decoded.username.trim();
    }
  }

  return null;
}

export async function findActivePersonalAccessToken(token: string) {
  if (!isPersonalAccessToken(token)) {
    return null;
  }

  const record = await prisma.personalAccessToken.findUnique({
    where: { tokenHash: hashPersonalAccessToken(token) },
    select: {
      id: true,
      userId: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!record) {
    return null;
  }
  if (record.revokedAt) {
    return null;
  }
  if (record.expiresAt && record.expiresAt <= new Date()) {
    return null;
  }

  return record satisfies GitPersonalAccessToken;
}

export async function touchPersonalAccessToken(tokenId: string) {
  await prisma.personalAccessToken.update({
    where: { id: tokenId },
    data: { lastUsedAt: new Date() },
  });
}

export function hasPatScope(scopes: string[], required: 'repo:read' | 'repo:write' | 'admin') {
  if (!scopes.length) {
    return false;
  }
  if (scopes.includes('admin')) {
    return true;
  }
  return scopes.includes(required);
}
