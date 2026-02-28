import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..', '..');
const dbDir = path.join(repoRoot, 'packages', 'db');
const pnpmExecPath = process.env.npm_execpath;

if (!pnpmExecPath) {
  throw new Error('Unable to resolve pnpm executable path from npm_execpath.');
}

execFileSync(process.execPath, [pnpmExecPath, 'build'], {
  cwd: dbDir,
  stdio: 'inherit',
});
