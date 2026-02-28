import { execFile } from 'node:child_process';
import { mkdir, access, chmod, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const hookScriptPath = fileURLToPath(
  new URL('../../scripts/validate-git-receive.mjs', import.meta.url),
);

function getHookScriptPath(): string {
  return hookScriptPath.replace(/\\/g, '/');
}

export async function ensureReceiveHook(repoDir: string): Promise<void> {
  const hooksDir = path.join(repoDir, 'hooks');
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, 'pre-receive');
  const scriptPath = getHookScriptPath();
  const content = `#!/bin/sh\nnode "${scriptPath}"\n`;
  await writeFile(hookPath, content, { encoding: 'utf8' });
  try {
    await chmod(hookPath, 0o755);
  } catch {
    // Ignore chmod errors on platforms that don't support it.
  }
}

export async function initBareRepo(
  rootDir: string,
  workspaceSlug: string,
  repoSlug: string,
): Promise<string> {
  const repoDir = path.join(rootDir, workspaceSlug, `${repoSlug}.git`);
  const parentDir = path.dirname(repoDir);

  await mkdir(parentDir, { recursive: true });

  try {
    await access(repoDir);
    throw new Error('Repository storage already exists.');
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  await execFileAsync('git', ['init', '--bare', repoDir]);
  await ensureReceiveHook(repoDir);
  return repoDir;
}

export async function cloneBareRepo(
  sourceRepoDir: string,
  targetRootDir: string,
  targetWorkspaceSlug: string,
  targetRepoSlug: string,
): Promise<string> {
  const targetRepoDir = path.join(
    targetRootDir,
    targetWorkspaceSlug,
    `${targetRepoSlug}.git`,
  );
  const parentDir = path.dirname(targetRepoDir);

  await mkdir(parentDir, { recursive: true });

  try {
    await access(targetRepoDir);
    throw new Error('Repository storage already exists.');
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  await execFileAsync('git', ['clone', '--bare', sourceRepoDir, targetRepoDir]);
  await ensureReceiveHook(targetRepoDir);
  return targetRepoDir;
}

export async function importRemoteRepo(
  repoDir: string,
  remoteUrl: string,
): Promise<void> {
  try {
    await execFileAsync('git', ['--git-dir', repoDir, 'remote', 'remove', 'origin']);
  } catch {
    // Ignore missing remote.
  }

  await execFileAsync('git', ['--git-dir', repoDir, 'remote', 'add', 'origin', remoteUrl]);
  await execFileAsync('git', [
    '--git-dir',
    repoDir,
    'fetch',
    '--prune',
    'origin',
    '+refs/heads/*:refs/heads/*',
    '+refs/tags/*:refs/tags/*',
  ]);
}

export async function setRepoHead(repoDir: string, branch: string): Promise<void> {
  await execFileAsync('git', [
    '--git-dir',
    repoDir,
    'symbolic-ref',
    'HEAD',
    `refs/heads/${branch}`,
  ]);
}

