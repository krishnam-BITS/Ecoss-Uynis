#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  clearProfileToken,
  getConfigPath,
  getProfile,
  readConfig,
  updateProfile,
  writeConfig,
} from '../src/config.mjs';

const LEGACY_ALIAS_MAP = {
  login: ['auth', 'login'],
  'create-repo': ['repo', 'create'],
  'import-zip': ['repo', 'import-zip'],
  'import-remote': ['repo', 'import-remote'],
  'create-token': ['token', 'create'],
  'list-tokens': ['token', 'list'],
  'revoke-token': ['token', 'revoke'],
  'upload-file': ['files', 'upload'],
  'set-check': ['checks', 'set'],
  'create-webhook-secret': ['webhook', 'secret'],
};

function parseArgs(argv) {
  const flags = new Map();
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    if (token.includes('=')) {
      const [key, ...rest] = token.slice(2).split('=');
      flags.set(key, rest.join('='));
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags.set(key, 'true');
      continue;
    }
    flags.set(key, next);
    i += 1;
  }
  return { flags, positionals };
}

function encodeQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}

function getFlag(flags, ...keys) {
  for (const key of keys) {
    const value = flags.get(key);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function hasFlag(flags, key) {
  return flags.has(key);
}

function requireFlag(flags, name, aliases = []) {
  const value = getFlag(flags, name, ...aliases);
  if (!value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const data = await readJson(response);
    const message = data?.message || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return readJson(response);
}

function resolveApi(flags, profileData) {
  return (
    getFlag(flags, 'api') ||
    process.env.UYNIS_API_URL ||
    profileData.apiUrl ||
    'http://localhost:4000'
  );
}

function resolveToken(flags, profileData) {
  return getFlag(flags, 'token') || process.env.UYNIS_TOKEN || profileData.token || '';
}

function requireToken(token) {
  if (!token) {
    throw new Error('No token found. Use --token, UYNIS_TOKEN, or `uynis auth login`.');
  }
  return token;
}

async function validateAuth(api, token) {
  requireToken(token);
  await requestJson(`${api}/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function printResult(data, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === 'string') {
    console.log(data);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log(`
Uynis CLI

Usage:
  uynis [global options] <command> [command options]

Global options:
  --api <url>      API base URL (default: http://localhost:4000)
  --token <pat>    PAT/token for authenticated calls
  --profile <name> Config profile name (default: current profile)
  --json           Print machine-readable JSON
  --help           Show help

Config profile commands:
  uynis config profile list
  uynis config show
  uynis config profile use --name <profile>
  uynis config profile set --name <profile> [--api <url>] [--token <pat>]

Auth commands:
  uynis auth login --identifier <email|phone|username> [--password <password>] [--no-save]
  uynis auth whoami
  uynis auth token set --token <pat>
  uynis auth token clear
  uynis auth logout

System commands:
  uynis system health
  uynis system ready

Workspace commands:
  uynis workspace list
  uynis workspace create --name <name> [--slug <slug>]

Repo commands:
  uynis repo create --workspace <id> --name <repo> [--visibility PUBLIC|PRIVATE|INTERNAL]
  uynis repo list --workspace <id>
  uynis repo import-zip --workspace <id> --repo <id> --file <archive.zip> [--branch <name>] [--message <text>]
  uynis repo import-remote --workspace <id> --repo <id> --url <git-url> [--branch <name>]
  uynis repo import-zip-async --workspace <id> --repo <id> --file <archive.zip> [--branch <name>] [--message <text>] [--max-attempts <n>]
  uynis repo import-remote-async --workspace <id> --repo <id> --url <git-url> [--branch <name>] [--max-attempts <n>]
  uynis repo import-jobs --workspace <id> --repo <id>
  uynis repo import-job --workspace <id> --repo <id> --job <jobId>
  uynis repo import-cancel --workspace <id> --repo <id> --job <jobId>

Token commands:
  uynis token create --name <name> [--scopes a,b,c] [--expires <days>]
  uynis token list
  uynis token revoke --token-id <id>

File/commit commands:
  uynis files upload --workspace <id> --repo <id> --path <repo/path> [--file <local>] [--content <text>] [--message <text>]

Checks and webhooks:
  uynis checks set --workspace <id> --repo <id> --sha <commitSha> --context <name> --status <QUEUED|IN_PROGRESS|SUCCESS|FAILURE> [--details <text>]
  uynis webhook secret --workspace <id> --repo <id>

Admin commands:
  uynis admin health
  uynis admin users [--q <text>] [--limit <n>]
  uynis admin workspaces [--q <text>] [--limit <n>]
  uynis admin repos [--q <text>] [--limit <n>]
  uynis admin pats [--q <text>] [--limit <n>]
  uynis admin revoke-pat --token-id <id>
  uynis admin webhooks [--active true|false] [--limit <n>]
  uynis admin import-jobs [--status QUEUED|RUNNING|COMPLETED|FAILED] [--limit <n>]
  uynis admin security events [--user-id <id>] [--event-type <type>] [--severity <level>] [--from <iso>] [--to <iso>] [--limit <n>]
  uynis admin security anomalies [--limit <n>]
  uynis admin security state --user-id <id>

Quick start:
  uynis config profile set --name local --api http://localhost:4000
  uynis auth login --identifier you@example.com
  uynis workspace list
  uynis repo list --workspace <workspaceId>

Compatibility aliases:
  login, create-repo, import-zip, import-remote, create-token, list-tokens, revoke-token,
  upload-file, set-check, create-webhook-secret
`);
}

async function promptForPassword() {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Password is required in non-interactive mode. Use --password.');
  }
  const rl = createInterface({ input, output, terminal: true });
  try {
    const answer = await rl.question('Password (input visible): ');
    return answer;
  } finally {
    rl.close();
  }
}

function toCommitChange(repoPath, filePath, content) {
  if (filePath) {
    return readFile(filePath).then((buffer) => ({
      path: repoPath || path.basename(filePath),
      contentBase64: buffer.toString('base64'),
    }));
  }
  if (repoPath && typeof content === 'string') {
    return Promise.resolve({ path: repoPath, content });
  }
  throw new Error('Provide either --file, or --path with --content.');
}

async function run() {
  const argv = process.argv.slice(2);
  const { flags, positionals } = parseArgs(argv);
  const jsonMode = hasFlag(flags, 'json');

  if (!positionals.length || hasFlag(flags, 'help') || positionals[0] === 'help') {
    printHelp();
    return;
  }

  const rawProfile = getFlag(flags, 'profile');
  const config = await readConfig();
  const profile = getProfile(config, rawProfile);
  const api = resolveApi(flags, profile.data);
  const token = resolveToken(flags, profile.data);

  const legacy = positionals[0];
  const command = LEGACY_ALIAS_MAP[legacy] || positionals;

  try {
    let authValidated = false;
    const ensureAuth = async () => {
      if (authValidated) {
        return;
      }
      await validateAuth(api, token);
      authValidated = true;
    };

    if (command[0] === 'system' && command[1] === 'health') {
      await ensureAuth();
      const data = await requestJson(`${api}/health`);
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'system' && command[1] === 'ready') {
      await ensureAuth();
      const data = await requestJson(`${api}/ready`);
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'config' && command[1] === 'profile' && command[2] === 'list') {
      const current = config.currentProfile || 'default';
      const profiles = Object.entries(config.profiles || {}).map(([name, value]) => ({
        name,
        apiUrl: value?.apiUrl || '',
        hasToken: Boolean(value?.token),
        current: name === current,
      }));
      printResult({ configPath: getConfigPath(), currentProfile: current, profiles }, jsonMode);
      return;
    }

    if (command[0] === 'config' && command[1] === 'show') {
      const current = config.currentProfile || 'default';
      const currentProfile = config.profiles?.[current] || {};
      printResult(
        {
          configPath: getConfigPath(),
          currentProfile: current,
          apiUrl: currentProfile.apiUrl || '',
          hasToken: Boolean(currentProfile.token),
        },
        jsonMode,
      );
      return;
    }

    if (command[0] === 'config' && command[1] === 'profile' && command[2] === 'use') {
      const name = requireFlag(flags, 'name');
      const next = {
        ...config,
        currentProfile: name,
        profiles: {
          ...(config.profiles || {}),
          [name]: config.profiles?.[name] || {},
        },
      };
      await writeConfig(next);
      printResult(`Current profile: ${name}`, jsonMode);
      return;
    }

    if (command[0] === 'config' && command[1] === 'profile' && command[2] === 'set') {
      const name = requireFlag(flags, 'name');
      const patch = {};
      const apiUrl = getFlag(flags, 'api');
      const token = getFlag(flags, 'token');
      if (apiUrl) {
        patch.apiUrl = apiUrl;
      }
      if (token) {
        patch.token = token;
      }
      const updated = await updateProfile(name, patch);
      printResult({ profile: name, apiUrl: updated.apiUrl || '', hasToken: Boolean(updated.token) }, jsonMode);
      return;
    }

    if (command[0] === 'auth' && command[1] === 'login') {
      const identifier = requireFlag(flags, 'identifier');
      const password = getFlag(flags, 'password') || (await promptForPassword());
      const response = await requestJson(`${api}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      const token = response?.token || '';
      if (!token) {
        throw new Error('Login succeeded but token was missing in response.');
      }
      const save = !hasFlag(flags, 'no-save');
      if (save) {
        await updateProfile(profile.name, { apiUrl: api, token });
      }
      printResult(save ? { token, saved: true, profile: profile.name } : { token, saved: false }, jsonMode);
      return;
    }

    if (command[0] === 'auth' && command[1] === 'whoami') {
      requireToken(token);
      const data = await requestJson(`${api}/me`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'auth' && command[1] === 'token' && command[2] === 'set') {
      const nextToken = requireFlag(flags, 'token');
      await updateProfile(profile.name, { apiUrl: api, token: nextToken });
      printResult(`Saved token to profile '${profile.name}'.`, jsonMode);
      return;
    }

    if (command[0] === 'auth' && command[1] === 'token' && command[2] === 'clear') {
      await clearProfileToken(profile.name);
      printResult(`Cleared token from profile '${profile.name}'.`, jsonMode);
      return;
    }

    if (command[0] === 'auth' && command[1] === 'logout') {
      await clearProfileToken(profile.name);
      printResult(`Logged out from profile '${profile.name}'.`, jsonMode);
      return;
    }

    if (command[0] === 'workspace' && command[1] === 'list') {
      await ensureAuth();
      const data = await requestJson(`${api}/workspaces`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'workspace' && command[1] === 'create') {
      await ensureAuth();
      const name = requireFlag(flags, 'name');
      const slug = getFlag(flags, 'slug');
      const payload = { name };
      if (slug) {
        payload.slug = slug;
      }
      const data = await requestJson(`${api}/workspaces`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      printResult(data, jsonMode);
      return;
    }

    await ensureAuth();

    if (command[0] === 'admin' && command[1] === 'health') {
      const data = await requestJson(`${api}/admin/health`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'users') {
      const suffix = encodeQuery({
        q: getFlag(flags, 'q'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/users${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'workspaces') {
      const suffix = encodeQuery({
        q: getFlag(flags, 'q'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/workspaces${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'repos') {
      const suffix = encodeQuery({
        q: getFlag(flags, 'q'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/repos${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'pats') {
      const suffix = encodeQuery({
        q: getFlag(flags, 'q'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/pats${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'revoke-pat') {
      const tokenId = requireFlag(flags, 'token-id');
      const data = await requestJson(`${api}/admin/pats/${tokenId}/revoke`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'webhooks') {
      const suffix = encodeQuery({
        active: getFlag(flags, 'active'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/webhooks${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'import-jobs') {
      const suffix = encodeQuery({
        status: getFlag(flags, 'status'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/import-jobs${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'security' && command[2] === 'events') {
      const suffix = encodeQuery({
        userId: getFlag(flags, 'user-id'),
        eventType: getFlag(flags, 'event-type'),
        severity: getFlag(flags, 'severity'),
        from: getFlag(flags, 'from'),
        to: getFlag(flags, 'to'),
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/security/events${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'security' && command[2] === 'anomalies') {
      const suffix = encodeQuery({
        limit: getFlag(flags, 'limit'),
      });
      const data = await requestJson(`${api}/admin/security/anomalies${suffix}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'admin' && command[1] === 'security' && command[2] === 'state') {
      const userId = requireFlag(flags, 'user-id');
      const data = await requestJson(`${api}/admin/security/state/${userId}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'create') {
      const workspace = requireFlag(flags, 'workspace');
      const name = requireFlag(flags, 'name');
      const visibility = getFlag(flags, 'visibility');
      const payload = { name };
      if (visibility) {
        payload.visibility = visibility;
      }
      const data = await requestJson(`${api}/workspaces/${workspace}/repos`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'list') {
      const workspace = requireFlag(flags, 'workspace');
      const data = await requestJson(`${api}/workspaces/${workspace}/repos`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-zip') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const filePath = requireFlag(flags, 'file');
      const branch = getFlag(flags, 'branch');
      const message = getFlag(flags, 'message');
      const buffer = await readFile(filePath);
      const form = new FormData();
      form.set('archive', new Blob([buffer]), path.basename(filePath));
      const query = new URLSearchParams();
      if (branch) {
        query.set('branch', branch);
      }
      if (message) {
        query.set('message', message);
      }
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import${suffix}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-remote') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const url = requireFlag(flags, 'url');
      const branch = getFlag(flags, 'branch');
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import/remote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url, branch: branch || undefined }),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-zip-async') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const filePath = requireFlag(flags, 'file');
      const branch = getFlag(flags, 'branch');
      const message = getFlag(flags, 'message');
      const maxAttempts = getFlag(flags, 'max-attempts');
      const buffer = await readFile(filePath);
      const form = new FormData();
      form.set('archive', new Blob([buffer]), path.basename(filePath));
      const query = new URLSearchParams();
      if (branch) {
        query.set('branch', branch);
      }
      if (message) {
        query.set('message', message);
      }
      if (maxAttempts) {
        query.set('maxAttempts', maxAttempts);
      }
      const suffix = query.toString() ? `?${query.toString()}` : '';
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import/jobs/zip${suffix}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-remote-async') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const url = requireFlag(flags, 'url');
      const branch = getFlag(flags, 'branch');
      const maxAttempts = getFlag(flags, 'max-attempts');
      const payload = { url };
      if (branch) {
        payload.branch = branch;
      }
      if (maxAttempts) {
        payload.maxAttempts = Number.parseInt(maxAttempts, 10);
      }
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import/jobs/remote`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-jobs') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import/jobs`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-job') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const job = requireFlag(flags, 'job');
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/import/jobs/${job}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'repo' && command[1] === 'import-cancel') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const job = requireFlag(flags, 'job');
      const data = await requestJson(
        `${api}/workspaces/${workspace}/repos/${repo}/import/jobs/${job}/cancel`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'token' && command[1] === 'create') {
      const name = requireFlag(flags, 'name');
      const scopes = getFlag(flags, 'scopes')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      const expires = getFlag(flags, 'expires');
      const payload = { name };
      if (scopes.length) {
        payload.scopes = scopes;
      }
      if (expires) {
        payload.expiresInDays = Number.parseInt(expires, 10);
      }
      const data = await requestJson(`${api}/me/pats`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'token' && command[1] === 'list') {
      const data = await requestJson(`${api}/me/pats`, {
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'token' && command[1] === 'revoke') {
      const tokenId = requireFlag(flags, 'token-id');
      const data = await requestJson(`${api}/me/pats/${tokenId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'files' && command[1] === 'upload') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const repoPath = requireFlag(flags, 'path');
      const filePath = getFlag(flags, 'file');
      const content = getFlag(flags, 'content');
      const message = getFlag(flags, 'message') || `Update ${repoPath}`;
      const change = await toCommitChange(repoPath, filePath, content);
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/commits`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message, changes: [change] }),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'checks' && command[1] === 'set') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const sha = requireFlag(flags, 'sha');
      const context = requireFlag(flags, 'context');
      const status = requireFlag(flags, 'status');
      const details = getFlag(flags, 'details');
      const payload = { context, status };
      if (details) {
        payload.details = details;
      }
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/commits/${sha}/checks`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      printResult(data, jsonMode);
      return;
    }

    if (command[0] === 'webhook' && command[1] === 'secret') {
      const workspace = requireFlag(flags, 'workspace');
      const repo = requireFlag(flags, 'repo');
      const data = await requestJson(`${api}/workspaces/${workspace}/repos/${repo}/webhook-secret`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      printResult(data, jsonMode);
      return;
    }

    printHelp();
    process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

run();
