import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

type ExecResult = {
  stdout: string | Buffer;
  stderr: string | Buffer;
};

type TreeEntry = {
  mode: string;
  type: 'tree' | 'blob';
  sha: string;
  size: number | null;
  name: string;
  path: string;
};

export type RepoTreeEntry = TreeEntry;

export type RepoBlob = {
  path: string;
  branch: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  contentBase64: string | null;
};

export type CommitChange = {
  path: string;
  content?: string;
  contentBase64?: string;
  delete?: boolean;
};

export type CommitResult = {
  sha: string;
  branch: string;
  changedPaths: string[];
};

export type MergeResult = {
  sha: string;
  sourceBranch: string;
  targetBranch: string;
  changedPaths: string[];
};

export type CompareFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type_changed'
  | 'unmerged'
  | 'unknown';

export type CompareFile = {
  path: string;
  previousPath?: string;
  status: CompareFileStatus;
  additions: number;
  deletions: number;
};

export type CompareResult = {
  baseBranch: string;
  headBranch: string;
  mergeBaseSha: string;
  aheadBy: number;
  behindBy: number;
  files: CompareFile[];
};

export type ComparePatchResult = {
  baseBranch: string;
  headBranch: string;
  path: string;
  patch: string;
  isTruncated: boolean;
};

type ExecOptions = {
  cwd?: string;
  encoding?: BufferEncoding | 'buffer';
};

type ExecError = Error & {
  code?: number | string;
  stderr?: string | Buffer;
};

function parseExecError(error: unknown): ExecError {
  return error as ExecError;
}

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
  return value
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}/gi, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function statusFromNameStatus(token: string): CompareFileStatus {
  const leading = token[0];
  switch (leading) {
    case 'A':
      return 'added';
    case 'M':
      return 'modified';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type_changed';
    case 'U':
      return 'unmerged';
    default:
      return 'unknown';
  }
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

export async function validateBranchName(branch: string): Promise<void> {
  const name = normalizeBranchName(branch);
  await runGit(['check-ref-format', '--branch', name]);
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

export async function getBranchHeadSha(
  repoDir: string,
  branch: string,
): Promise<string | null> {
  const name = normalizeBranchName(branch);
  if (!name) {
    return null;
  }

  try {
    const { stdout } = await runGitBare(repoDir, [
      'rev-parse',
      `refs/heads/${name}`,
    ]);
    const sha = String(stdout).trim();
    return sha ? sha.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function createBranch(
  repoDir: string,
  branch: string,
  fromBranch: string,
): Promise<{ name: string; sha: string }> {
  const name = normalizeBranchName(branch);
  const source = normalizeBranchName(fromBranch);

  await validateBranchName(name);
  await validateBranchName(source);

  if (await branchExists(repoDir, name)) {
    throw new Error('Branch already exists.');
  }

  if (!(await branchExists(repoDir, source))) {
    throw new Error('Source branch does not exist yet.');
  }

  await runGitBare(repoDir, ['branch', name, `refs/heads/${source}`]);
  const { stdout } = await runGitBare(repoDir, [
    'rev-parse',
    `refs/heads/${name}`,
  ]);

  return {
    name,
    sha: String(stdout).trim(),
  };
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

export async function compareBranches(
  repoDir: string,
  baseBranch: string,
  headBranch: string,
): Promise<CompareResult> {
  const base = normalizeBranchName(baseBranch);
  const head = normalizeBranchName(headBranch);

  await Promise.all([validateBranchName(base), validateBranchName(head)]);

  if (!(await branchExists(repoDir, base))) {
    throw new Error('Base branch does not exist.');
  }
  if (!(await branchExists(repoDir, head))) {
    throw new Error('Head branch does not exist.');
  }

  const rangeSpec = `${base}...${head}`;
  const [
    { stdout: mergeBaseStdout },
    { stdout: revListStdout },
    { stdout: nameStatusStdout },
    { stdout: numStatStdout },
  ] = await Promise.all([
    runGitBare(repoDir, ['merge-base', base, head]),
    runGitBare(repoDir, ['rev-list', '--left-right', '--count', rangeSpec]),
    runGitBare(repoDir, ['diff', '--name-status', '--find-renames', rangeSpec]),
    runGitBare(repoDir, ['diff', '--numstat', '--find-renames', rangeSpec]),
  ]);

  const mergeBaseSha = String(mergeBaseStdout).trim();

  const [behindRaw, aheadRaw] = String(revListStdout)
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10) || 0);

  const statsByPath = new Map<string, { additions: number; deletions: number }>();
  for (const line of String(numStatStdout).split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    if (parts.length < 3) {
      continue;
    }
    const additions = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10) || 0;
    const deletions = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10) || 0;
    const filePath = parts.length >= 4 ? parts[3] : parts[2];
    statsByPath.set(filePath, { additions, deletions });
  }

  const files: CompareFile[] = String(nameStatusStdout)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      if (parts.length < 2) {
        return null;
      }
      const token = parts[0];
      const status = statusFromNameStatus(token);
      const isRenameLike = token.startsWith('R') || token.startsWith('C');
      const path = isRenameLike ? parts[2] : parts[1];
      if (!path) {
        return null;
      }
      const stat = statsByPath.get(path);
      return {
        path,
        previousPath: isRenameLike ? parts[1] : undefined,
        status,
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      } satisfies CompareFile;
    })
    .filter((entry): entry is CompareFile => Boolean(entry));

  return {
    baseBranch: base,
    headBranch: head,
    mergeBaseSha,
    aheadBy: aheadRaw,
    behindBy: behindRaw,
    files,
  };
}

export async function readComparePatch(input: {
  repoDir: string;
  baseBranch: string;
  headBranch: string;
  filePath: string;
  maxBytes?: number;
}): Promise<ComparePatchResult> {
  const base = normalizeBranchName(input.baseBranch);
  const head = normalizeBranchName(input.headBranch);
  const filePath = normalizeRepoPath(input.filePath);
  const maxBytes = input.maxBytes ?? 300_000;

  await Promise.all([validateBranchName(base), validateBranchName(head)]);
  if (!(await branchExists(input.repoDir, base))) {
    throw new Error('Base branch does not exist.');
  }
  if (!(await branchExists(input.repoDir, head))) {
    throw new Error('Head branch does not exist.');
  }
  if (!filePath) {
    throw new Error('Invalid path.');
  }

  const { stdout } = await runGitBare(
    input.repoDir,
    ['diff', '--no-color', '--unified=3', `${base}...${head}`, '--', filePath],
    { encoding: 'buffer' },
  );
  const patchBuffer = Buffer.isBuffer(stdout)
    ? stdout
    : Buffer.from(String(stdout), 'utf8');
  const isTruncated = patchBuffer.length > maxBytes;
  const visibleBuffer = isTruncated ? patchBuffer.subarray(0, maxBytes) : patchBuffer;
  const patch = visibleBuffer.toString('utf8');

  return {
    baseBranch: base,
    headBranch: head,
    path: filePath,
    patch,
    isTruncated,
  };
}

function hasStagedChangesError(error: unknown): boolean {
  const parsed = parseExecError(error);
  return parsed.code === 1;
}

function isMergeConflictError(error: unknown): boolean {
  const parsed = parseExecError(error);
  const stderr = String(parsed.stderr ?? '');
  return (
    parsed.code === 1 &&
    (stderr.includes('CONFLICT') ||
      stderr.includes('Automatic merge failed') ||
      stderr.includes('Merge conflict'))
  );
}

export async function createCommitWithChanges(input: {
  repoDir: string;
  branch: string;
  baseBranch?: string;
  message: string;
  authorName: string;
  authorEmail: string;
  changes: CommitChange[];
}): Promise<CommitResult> {
  const branch = normalizeBranchName(input.branch);
  const baseBranch = input.baseBranch
    ? normalizeBranchName(input.baseBranch)
    : undefined;

  await validateBranchName(branch);

  const workingDir = await mkdtemp(path.join(os.tmpdir(), 'uynis-repo-'));

  try {
    await runGit(['clone', '--quiet', input.repoDir, workingDir]);

    const targetExists = await branchExists(input.repoDir, branch);
    if (targetExists) {
      await runGit(['checkout', '--quiet', branch], { cwd: workingDir });
    } else if (baseBranch && (await branchExists(input.repoDir, baseBranch))) {
      await runGit(
        ['checkout', '--quiet', '-b', branch, `origin/${baseBranch}`],
        { cwd: workingDir },
      );
    } else {
      await runGit(['checkout', '--quiet', '--orphan', branch], {
        cwd: workingDir,
      });
    }

    const changedPaths: string[] = [];

    for (const change of input.changes) {
      const cleanPath = normalizeRepoPath(change.path);
      if (!cleanPath) {
        continue;
      }

      const absolutePath = path.join(workingDir, ...cleanPath.split('/'));
      if (change.delete) {
        await rm(absolutePath, { force: true });
        changedPaths.push(cleanPath);
        continue;
      }

      await mkdir(path.dirname(absolutePath), { recursive: true });
      if (change.contentBase64) {
        await writeFile(
          absolutePath,
          Buffer.from(change.contentBase64, 'base64'),
        );
      } else {
        await writeFile(absolutePath, change.content ?? '', 'utf8');
      }
      changedPaths.push(cleanPath);
    }

    await runGit(['add', '-A'], { cwd: workingDir });

    let hasChanges = false;
    try {
      await runGit(['diff', '--cached', '--quiet'], { cwd: workingDir });
    } catch (error) {
      if (hasStagedChangesError(error)) {
        hasChanges = true;
      } else {
        throw error;
      }
    }

    if (!hasChanges) {
      throw new Error('No changes to commit.');
    }

    await runGit(
      [
        '-c',
        `user.name=${input.authorName}`,
        '-c',
        `user.email=${input.authorEmail}`,
        'commit',
        '--quiet',
        '-m',
        input.message.trim(),
      ],
      { cwd: workingDir },
    );

    await runGit(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], {
      cwd: workingDir,
    });

    const { stdout } = await runGit(['rev-parse', 'HEAD'], { cwd: workingDir });

    return {
      sha: String(stdout).trim(),
      branch,
      changedPaths,
    };
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

export async function mergeBranches(input: {
  repoDir: string;
  sourceBranch: string;
  targetBranch: string;
  authorName: string;
  authorEmail: string;
  message?: string;
}): Promise<MergeResult> {
  const sourceBranch = normalizeBranchName(input.sourceBranch);
  const targetBranch = normalizeBranchName(input.targetBranch);

  await validateBranchName(sourceBranch);
  await validateBranchName(targetBranch);

  if (sourceBranch === targetBranch) {
    throw new Error('Source and target branch must be different.');
  }

  if (!(await branchExists(input.repoDir, sourceBranch))) {
    throw new Error('Source branch does not exist.');
  }
  if (!(await branchExists(input.repoDir, targetBranch))) {
    throw new Error('Target branch does not exist.');
  }

  const workingDir = await mkdtemp(path.join(os.tmpdir(), 'uynis-merge-'));

  try {
    await runGit(['clone', '--quiet', input.repoDir, workingDir]);
    await runGit(
      ['checkout', '--quiet', '-B', targetBranch, `origin/${targetBranch}`],
      { cwd: workingDir },
    );

    const mergeArgs = [
      '-c',
      `user.name=${input.authorName}`,
      '-c',
      `user.email=${input.authorEmail}`,
      'merge',
      '--no-ff',
      '--no-edit',
      `origin/${sourceBranch}`,
    ];
    const mergeMessage = input.message?.trim();
    if (mergeMessage) {
      mergeArgs.push('-m', mergeMessage);
    }

    try {
      await runGit(mergeArgs, { cwd: workingDir });
    } catch (error) {
      try {
        await runGit(['merge', '--abort'], { cwd: workingDir });
      } catch {
        // Ignore abort failures and surface the original merge error.
      }
      if (isMergeConflictError(error)) {
        throw new Error('Merge conflict. Rebase or update branches and try again.');
      }
      throw error;
    }

    await runGit(
      ['push', '--quiet', 'origin', `HEAD:refs/heads/${targetBranch}`],
      { cwd: workingDir },
    );

    const [{ stdout: shaStdout }, { stdout: changedStdout }] =
      await Promise.all([
        runGit(['rev-parse', 'HEAD'], { cwd: workingDir }),
        runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], {
          cwd: workingDir,
        }),
      ]);

    const changedPaths = String(changedStdout)
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    return {
      sha: String(shaStdout).trim(),
      sourceBranch,
      targetBranch,
      changedPaths,
    };
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

