import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PROFILE = 'default';

function defaultConfigPath() {
  return path.join(os.homedir(), '.uynis', 'config.json');
}

export function getConfigPath() {
  return process.env.UYNIS_CLI_CONFIG || defaultConfigPath();
}

export async function readConfig() {
  const filePath = getConfigPath();
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { currentProfile: DEFAULT_PROFILE, profiles: {} };
    }
    return {
      currentProfile: parsed.currentProfile || DEFAULT_PROFILE,
      profiles: parsed.profiles || {},
    };
  } catch {
    return { currentProfile: DEFAULT_PROFILE, profiles: {} };
  }
}

export async function writeConfig(config) {
  const filePath = getConfigPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify(config, null, 2);
  await writeFile(filePath, payload, 'utf8');
}

export function getProfile(config, profileName) {
  const name = profileName || config.currentProfile || DEFAULT_PROFILE;
  return {
    name,
    data: config.profiles?.[name] || {},
  };
}

export async function updateProfile(profileName, patch) {
  const config = await readConfig();
  const name = profileName || config.currentProfile || DEFAULT_PROFILE;
  const existing = config.profiles?.[name] || {};
  const next = {
    ...config,
    currentProfile: name,
    profiles: {
      ...(config.profiles || {}),
      [name]: {
        ...existing,
        ...patch,
      },
    },
  };
  await writeConfig(next);
  return next.profiles[name];
}

export async function clearProfileToken(profileName) {
  const config = await readConfig();
  const name = profileName || config.currentProfile || DEFAULT_PROFILE;
  const existing = config.profiles?.[name] || {};
  const next = {
    ...config,
    currentProfile: name,
    profiles: {
      ...(config.profiles || {}),
      [name]: {
        ...existing,
        token: '',
      },
    },
  };
  await writeConfig(next);
}

