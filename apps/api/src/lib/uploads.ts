import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const uploadsRoot =
  process.env.UPLOADS_PATH ?? path.join(process.cwd(), 'data', 'uploads');

export function getUploadsRoot(): string {
  return uploadsRoot;
}

export function getAvatarUploadsDir(): string {
  return path.join(uploadsRoot, 'avatars');
}

export function getAttachmentUploadsDir(): string {
  return path.join(uploadsRoot, 'attachments');
}

export async function ensureUploadsDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
