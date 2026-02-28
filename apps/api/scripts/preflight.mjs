import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0]);
const apiPort = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const lifecycleEvent = process.env.npm_lifecycle_event ?? '';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const dbDir = path.join(repoRoot, 'packages', 'db');
const pnpmExecPath = process.env.npm_execpath;
const shouldCheckApiPort = lifecycleEvent === 'predev' || lifecycleEvent === 'prestart';

if (major >= 24) {
  console.warn(
    'Warning: Node 24+ detected. Node 22 is recommended for local API runtime consistency.',
  );
}

if (!pnpmExecPath) {
  throw new Error('Unable to resolve pnpm executable path from npm_execpath.');
}

const execText = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
};

const getWindowsListeningPids = (port) => {
  const output = execText('netstat', ['-ano', '-p', 'tcp']);
  const pids = new Set();

  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5) {
      continue;
    }
    const [protocol, localAddress, , state, pid] = columns;
    if (
      protocol !== 'TCP' ||
      state.toUpperCase() !== 'LISTENING' ||
      !localAddress.endsWith(`:${port}`)
    ) {
      continue;
    }
    if (!/^\d+$/.test(pid)) {
      continue;
    }
    pids.add(Number.parseInt(pid, 10));
  }

  return [...pids];
};

const getWindowsProcessName = (pid) => {
  const output = execText('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).trim();
  if (!output || output.startsWith('INFO:')) {
    return null;
  }
  const match = output.match(/^"([^"]+)"/);
  return match ? match[1] : null;
};

const killWindowsPid = (pid) => {
  execFileSync('taskkill', ['/PID', String(pid), '/F'], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
};

const ensureApiPortAvailable = (port) => {
  if (!Number.isInteger(port) || port <= 0) {
    return;
  }
  if (process.platform !== 'win32') {
    return;
  }

  const listeners = getWindowsListeningPids(port).filter((pid) => pid !== process.pid);
  if (listeners.length === 0) {
    return;
  }

  const killableNodePids = [];
  const blockingProcesses = [];

  for (const pid of listeners) {
    const processName = (getWindowsProcessName(pid) ?? '').toLowerCase();
    if (processName.includes('node')) {
      killableNodePids.push(pid);
      continue;
    }
    blockingProcesses.push(`${pid}${processName ? ` (${processName})` : ''}`);
  }

  if (blockingProcesses.length > 0) {
    throw new Error(
      `API port ${port} is already in use by non-node process(es): ${blockingProcesses.join(
        ', ',
      )}. Stop the process or set API_PORT.`,
    );
  }

  for (const pid of killableNodePids) {
    killWindowsPid(pid);
  }

  const remaining = getWindowsListeningPids(port).filter((pid) => pid !== process.pid);
  if (remaining.length > 0) {
    throw new Error(
      `API port ${port} is still in use by PID(s): ${remaining.join(
        ', ',
      )}. Stop them manually and retry.`,
    );
  }

  console.warn(
    `[preflight] Freed API port ${port} by stopping stale node process(es): ${killableNodePids.join(
      ', ',
    )}.`,
  );
};

const resolvedDatabaseUrl =
  process.env.DATABASE_URL ??
  process.env.DATABASE_URL_DOCKER ??
  'postgresql://postgres:postgres@postgres:5432/uynis';

const runPnpm = (args) =>
  execFileSync(process.execPath, [pnpmExecPath, ...args], {
    cwd: dbDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: resolvedDatabaseUrl,
    },
  });

if (shouldCheckApiPort) {
  ensureApiPortAvailable(apiPort);
}

runPnpm(['migrate:deploy']);
runPnpm(['build']);

if (shouldCheckApiPort) {
  ensureApiPortAvailable(apiPort);
}
