import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

type ExecResult = {
  stdout: string | Buffer;
  stderr: string | Buffer;
};

type ExecOptions = {
  cwd?: string;
  encoding?: BufferEncoding | 'buffer';
};

type RepoTreeEntry = {
  mode: string;
  type: 'tree' | 'blob';
  sha: string;
  size: number | null;
  name: string;
  path: string;
};

export type RepoBlob = {
  path: string;
  branch: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  contentBase64: string | null;
};

export type CommitInfo = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

async function runGit(
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const encoding = options.encoding === 'buffer' ? 'buffer' : 'utf8';
  const result = await execFileAsync('git', args, {
    cwd: options.cwd,
    encoding,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return result as ExecResult;
}

async function runGitBare(
  repoDir: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return runGit(['--git-dir', repoDir, ...args], options);
}

function normalizeBranchName(value: string): string {
  return value.trim();
}

export function normalizeRepoPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').trim().replace(/^\/+/, '');
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) {
    return '';
  }

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Invalid path.');
  }

  return segments.join('/');
}

export async function getRepoDir(
  rootDir: string,
  workspaceSlug: string,
  repoSlug: string,
): Promise<string> {
  const repoDir = path.join(rootDir, workspaceSlug, `${repoSlug}.git`);
  await access(repoDir);
  return repoDir;
}

export async function branchExists(
  repoDir: string,
  branch: string,
): Promise<boolean> {
  const name = normalizeBranchName(branch);
  if (!name) {
    return false;
  }

  try {
    await runGitBare(repoDir, ['rev-parse', '--verify', `refs/heads/${name}`]);
    return true;
  } catch {
    return false;
  }
}

export async function listRepoTree(
  repoDir: string,
  branch: string,
  currentPath = '',
): Promise<RepoTreeEntry[]> {
  const cleanBranch = normalizeBranchName(branch);
  const cleanPath = normalizeRepoPath(currentPath);

  if (!cleanBranch) {
    return [];
  }

  if (!(await branchExists(repoDir, cleanBranch))) {
    return [];
  }

  const treeSpec = cleanPath ? `${cleanBranch}:${cleanPath}` : cleanBranch;

  try {
    const { stdout } = await runGitBare(repoDir, [
      'ls-tree',
      '-z',
      '-l',
      treeSpec,
    ]);
    const output = String(stdout);
    if (!output) {
      return [];
    }

    const entries: RepoTreeEntry[] = output
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const match = line.match(
          /^([0-9]+)\s+(blob|tree)\s+([0-9a-f]{40})\s+([0-9-]+)\t(.+)$/,
        );
        if (!match) {
          return null;
        }

        const [, mode, type, sha, sizeToken, name] = match;
        const entryPath = cleanPath ? `${cleanPath}/${name}` : name;

        return {
          mode,
          type,
          sha,
          size: sizeToken === '-' ? null : Number(sizeToken),
          name,
          path: entryPath,
        } satisfies RepoTreeEntry;
      })
      .filter((entry): entry is RepoTreeEntry => Boolean(entry))
      .sort((left, right) => {
        if (left.type !== right.type) {
          return left.type === 'tree' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

    return entries;
  } catch {
    return [];
  }
}

export async function readRepoBlob(
  repoDir: string,
  branch: string,
  filePath: string,
): Promise<RepoBlob | null> {
  const cleanBranch = normalizeBranchName(branch);
  const cleanPath = normalizeRepoPath(filePath);

  if (!cleanBranch || !cleanPath) {
    return null;
  }

  if (!(await branchExists(repoDir, cleanBranch))) {
    return null;
  }

  try {
    const [{ stdout: shaStdout }, { stdout: blobStdout }] = await Promise.all([
      runGitBare(repoDir, ['rev-parse', `${cleanBranch}:${cleanPath}`]),
      runGitBare(repoDir, ['show', `${cleanBranch}:${cleanPath}`], {
        encoding: 'buffer',
      }),
    ]);

    const blob = Buffer.isBuffer(blobStdout)
      ? blobStdout
      : Buffer.from(String(blobStdout), 'utf8');
    const isBinary = blob.includes(0);
    return {
      path: cleanPath,
      branch: cleanBranch,
      sha: String(shaStdout).trim(),
      size: blob.length,
      isBinary,
      content: isBinary ? null : blob.toString('utf8'),
      contentBase64: isBinary ? blob.toString('base64') : null,
    };
  } catch {
    return null;
  }
}

export async function listCommits(
  repoDir: string,
  branch: string,
  limit: number,
): Promise<CommitInfo[]> {
  const format = '%H%x1f%an%x1f%ad%x1f%s%x1e';

  try {
    const { stdout } = await execFileAsync('git', [
      '--git-dir',
      repoDir,
      'log',
      branch,
      '-n',
      String(limit),
      `--pretty=format:${format}`,
      '--date=iso-strict',
    ]);

    const trimmed = stdout.trim();
    if (!trimmed) {
      return [];
    }

    return trimmed
      .split('\x1e')
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [sha, author, date, message] = record.split('\x1f');
        return {
          sha: sha.trim(),
          author: author.trim(),
          date: date.trim(),
          message: message.trim(),
        };
      });
  } catch {
    return [];
  }
}
