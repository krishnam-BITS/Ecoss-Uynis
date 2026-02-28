import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@uynis/db';

const tokenSecret =
  process.env.UPLOAD_TOKEN_SECRET ??
  process.env.JWT_SECRET ??
  'dev-secret-change-me';

export function resolveUploadStoragePath(uploadId: string, fileName?: string | null) {
  const safeName = fileName ? path.basename(fileName) : 'upload.bin';
  return `imports/uploads/${uploadId}-${safeName}`;
}

function hashToken(token: string) {
  return createHmac('sha256', tokenSecret).update(token).digest('hex');
}

export async function createUploadToken(input: {
  purpose: 'REPO_IMPORT_ARCHIVE' | 'AVATAR';
  repoId?: string;
  createdById?: string;
  maxBytes: number;
  contentType?: string;
  fileName?: string;
  expiresInMinutes?: number;
  storagePath: string;
}) {
  const raw = randomBytes(32).toString('hex');
  const token = `ut_${raw}`;
  const tokenHash = hashToken(token);
  const tokenPrefix = token.slice(0, 12);
  const expiresAt = new Date(
    Date.now() + (input.expiresInMinutes ?? 30) * 60 * 1000,
  );

  const record = await prisma.uploadToken.create({
    data: {
      purpose: input.purpose,
      repoId: input.repoId,
      createdById: input.createdById,
      maxBytes: input.maxBytes,
      contentType: input.contentType,
      fileName: input.fileName,
      storagePath: input.storagePath,
      tokenHash,
      tokenPrefix,
      expiresAt,
    },
  });

  return { token, record };
}

export async function verifyUploadToken(uploadId: string, token: string) {
  const record = await prisma.uploadToken.findUnique({
    where: { id: uploadId },
  });
  if (!record) {
    return null;
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return null;
  }
  if (record.consumedAt) {
    return null;
  }
  const tokenHash = hashToken(token);
  if (tokenHash !== record.tokenHash) {
    return null;
  }
  return record;
}

export async function markUploadConsumed(uploadId: string) {
  return prisma.uploadToken.update({
    where: { id: uploadId },
    data: { consumedAt: new Date() },
  });
}
