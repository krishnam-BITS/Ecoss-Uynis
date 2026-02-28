const BLOCKED_AUTH_REDIRECT_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-id',
  '/forgot-password',
];

function decodeOnce(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCandidate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return decodeOnce(value).trim();
}

function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith('/')) {
    return false;
  }
  if (value.startsWith('//')) {
    return false;
  }
  if (value.includes('\\')) {
    return false;
  }
  return true;
}

function isBlockedRedirectPath(value: string): boolean {
  return BLOCKED_AUTH_REDIRECT_PREFIXES.some((prefix) =>
    value === prefix || value.startsWith(`${prefix}?`),
  );
}

export function resolvePostAuthRedirect(params: {
  redirect?: string | null;
  from?: string | null;
  fallback?: string;
}): string {
  const fallback = params.fallback ?? '/';
  const candidates = [params.redirect, params.from];

  for (const candidate of candidates) {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) {
      continue;
    }
    if (!isSafeInternalPath(normalized)) {
      continue;
    }
    if (isBlockedRedirectPath(normalized)) {
      continue;
    }
    return normalized;
  }

  return fallback;
}
