import { createHmac, randomBytes } from 'node:crypto';

const tokenSecret =
  process.env.WORKSPACE_INVITE_TOKEN_SECRET ??
  process.env.PAT_HASH_SECRET ??
  process.env.JWT_SECRET ??
  'dev-invite-secret-change-me';

const INVITE_TOKEN_PREFIX = 'wi_';

export function generateWorkspaceInviteToken() {
  const raw = randomBytes(32).toString('base64url');
  return `${INVITE_TOKEN_PREFIX}${raw}`;
}

export function hashWorkspaceInviteToken(token: string): string {
  return createHmac('sha256', tokenSecret).update(token).digest('hex');
}

export function getWorkspaceInviteTokenPrefix(token: string): string {
  return token.slice(0, 12);
}

export type WorkspaceInviteTarget =
  | { type: 'email'; value: string }
  | { type: 'username'; value: string };

export function parseWorkspaceInviteTarget(
  identifier: string,
): WorkspaceInviteTarget {
  const trimmed = identifier.trim();
  if (!trimmed) {
    throw new Error('Invite target is required.');
  }

  if (trimmed.includes('@')) {
    return { type: 'email', value: trimmed.toLowerCase() };
  }

  return { type: 'username', value: trimmed.toLowerCase() };
}

export function getWorkspaceInviteExpiryDate(hours = 168): Date {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 168;
  return new Date(Date.now() + safeHours * 60 * 60 * 1000);
}
