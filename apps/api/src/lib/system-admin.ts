import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type SystemAdminConfig = {
  adminUserIds: Set<string>;
  adminEmails: Set<string>;
  allowDevFallback: boolean;
};

function parseCsvSet(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeEmail(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, '');
  return normalized.length ? normalized : null;
}

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function findNearestEnvFile() {
  let current = process.cwd();

  while (true) {
    const candidate = resolve(current, '.env');
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readRuntimeEnvFile() {
  const envPath = findNearestEnvFile();
  if (!envPath) {
    return new Map<string, string>();
  }

  try {
    const raw = readFileSync(envPath, 'utf8');
    const values = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1));
      if (key) {
        values.set(key, value);
      }
    }

    return values;
  } catch {
    return new Map<string, string>();
  }
}

function getRuntimeSetting(key: string) {
  const fileValues = readRuntimeEnvFile();
  const fileValue = fileValues.get(key);
  if (typeof fileValue === 'string') {
    return fileValue;
  }
  return process.env[key];
}

export function getSystemAdminConfig(): SystemAdminConfig {
  const adminUserIds = parseCsvSet(getRuntimeSetting('ADMIN_USER_IDS'));
  const adminEmails = new Set(
    [...parseCsvSet(getRuntimeSetting('ADMIN_EMAILS'))]
      .map((value) => normalizeEmail(value))
      .filter((value): value is string => Boolean(value)),
  );
  const allowDevFallback =
    getRuntimeSetting('ALLOW_DEV_ADMIN_FALLBACK')?.trim().toLowerCase() === 'true';

  return {
    adminUserIds,
    adminEmails,
    allowDevFallback,
  };
}

export function isConfiguredSystemAdmin(viewer: { id: string; email: string | null }) {
  const config = getSystemAdminConfig();
  const normalizedEmail = normalizeEmail(viewer.email);

  return (
    config.adminUserIds.has(viewer.id) ||
    (normalizedEmail ? config.adminEmails.has(normalizedEmail) : false) ||
    config.allowDevFallback
  );
}
