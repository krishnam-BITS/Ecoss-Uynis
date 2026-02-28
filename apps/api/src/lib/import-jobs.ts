import AdmZip from 'adm-zip';
import { prisma } from '@uynis/db';
import { createCommitWithChanges, normalizeRepoPath } from './git-engine.js';
import { getRepoDir, listBranches, listCommits } from './git-info.js';
import { importRemoteRepo, setRepoHead } from './git.js';
import { selectBranchRule } from './branch-rules.js';
import { deleteObject, getObjectBuffer, putObject } from './object-store.js';

const retryBaseMs = Number.parseInt(process.env.IMPORT_JOB_RETRY_BASE_MS ?? '30000', 10);

export async function ensureImportJobsDir() {
  return;
}

export async function saveImportArchive(jobId: string, buffer: Buffer): Promise<string> {
  const objectKey = `imports/jobs/${jobId}.zip`;
  await putObject({
    key: objectKey,
    body: buffer,
    contentType: 'application/zip',
  });
  return objectKey;
}

export function scheduleImportJob(jobId: string) {
  void prisma.repoImportJob
    .updateMany({
      where: {
        id: jobId,
        status: 'QUEUED',
      },
      data: {
        nextRunAt: new Date(),
      },
    })
    .catch(() => {
      // Worker polling loop will pick up queued jobs even if this hint fails.
    });
}

export async function processImportJob(jobId: string): Promise<
  'skipped' | 'completed' | 'retried' | 'failed'
> {
  const record = await prisma.repoImportJob.findUnique({
    where: { id: jobId },
  });
  if (!record) {
    return 'skipped';
  }

  const updated = await prisma.repoImportJob.updateMany({
    where: {
      id: jobId,
      status: 'QUEUED',
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: new Date() } }],
      attempts: { lt: record.maxAttempts },
    },
    data: {
      status: 'RUNNING',
      attempts: { increment: 1 },
      nextRunAt: null,
    },
  });
  if (!updated.count) {
    return 'skipped';
  }

  const job = await prisma.repoImportJob.findUnique({
    where: { id: jobId },
    include: {
      repo: { include: { workspace: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!job) {
    return 'skipped';
  }

  try {
    if (job.type === 'ZIP') {
      await runZipImport(job);
    } else {
      await runRemoteImport(job);
    }
    return 'completed';
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to import repository.';
    const shouldRetry = job.attempts < job.maxAttempts;
    await prisma.repoImportJob.update({
      where: { id: jobId },
      data: {
        status: shouldRetry ? 'QUEUED' : 'FAILED',
        error: message,
        nextRunAt: shouldRetry
          ? new Date(Date.now() + retryBaseMs * Math.max(1, job.attempts + 1))
          : null,
      },
    });
    return shouldRetry ? 'retried' : 'failed';
  } finally {
    if (job.archivePath) {
      await deleteObject(job.archivePath);
    }
  }
}

async function runZipImport(job: {
  id: string;
  repoId: string;
  branch: string | null;
  message: string | null;
  archivePath: string | null;
  createdById: string | null;
  createdBy: { name: string | null; email: string | null } | null;
  repo: { id: string; slug: string; defaultBranch: string; workspace: { slug: string } };
}) {
  if (!job.archivePath) {
    throw new Error('Archive file is missing.');
  }

  const branch = job.branch || job.repo.defaultBranch;

  const rules = await prisma.branchRule.findMany({
    where: { repoId: job.repoId },
    select: {
      id: true,
      pattern: true,
      requirePr: true,
      requireCodeOwners: true,
      requireApprovals: true,
      blockDirectPush: true,
      updatedAt: true,
    },
  });
  const matchedRule = selectBranchRule(rules, branch);
  if (
    matchedRule &&
    (matchedRule.blockDirectPush ||
      matchedRule.requirePr ||
      matchedRule.requireCodeOwners)
  ) {
    throw new Error(
      `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
    );
  }

  const buffer = await getObjectBuffer(job.archivePath);
  if (!buffer.length) {
    throw new Error('Archive is empty.');
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('Archive could not be read.');
  }

  const entries = zip.getEntries();
  const fileEntries = entries.filter(
    (entry) =>
      !entry.isDirectory &&
      !entry.entryName.startsWith('.git/') &&
      !entry.entryName.startsWith('__MACOSX/'),
  );
  const topLevelFolders = new Set(
    fileEntries
      .map((entry) => entry.entryName.split('/')[0])
      .filter(Boolean),
  );
  const stripPrefix = topLevelFolders.size === 1 ? [...topLevelFolders][0] : null;

  const changes = fileEntries.flatMap((entry) => {
    if (entry.isDirectory) {
      return [];
    }
    const entryName =
      stripPrefix && entry.entryName.startsWith(`${stripPrefix}/`)
        ? entry.entryName.slice(stripPrefix.length + 1)
        : entry.entryName;
    let cleanPath = '';
    try {
      cleanPath = normalizeRepoPath(entryName);
    } catch {
      return [];
    }
    if (!cleanPath) {
      return [];
    }
    const data = entry.getData();
    if (!data?.length) {
      return [];
    }
    return [
      {
        path: cleanPath,
        contentBase64: data.toString('base64'),
      },
    ];
  });

  if (!changes.length) {
    throw new Error('Archive contained no files.');
  }
  if (changes.length > 5000) {
    throw new Error('Archive contains too many files.');
  }

  const authorName =
    job.createdBy?.name?.trim() ??
    job.createdBy?.email?.split('@')[0] ??
    'Uynis user';
  const authorEmail =
    job.createdBy?.email ??
    `${job.createdById ?? 'uynis'}@uynis.local`;

  const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
  const repoDir = await getRepoDir(repoRoot, job.repo.workspace.slug, job.repo.slug);
  const commit = await createCommitWithChanges({
    repoDir,
    branch,
    baseBranch: job.repo.defaultBranch,
    message: job.message ?? 'Import repository archive',
    authorName,
    authorEmail,
    changes,
  });

  await prisma.repoImportJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      commitSha: commit.sha,
      importedFiles: commit.changedPaths.length,
    },
  });
}

async function runRemoteImport(job: {
  id: string;
  repoId: string;
  branch: string | null;
  importUrl: string | null;
  repo: { id: string; slug: string; defaultBranch: string; workspace: { slug: string } };
}) {
  if (!job.importUrl) {
    throw new Error('Import URL is missing.');
  }

  const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
  const repoDir = await getRepoDir(repoRoot, job.repo.workspace.slug, job.repo.slug);

  const existingCommits = await listCommits(repoDir, job.repo.defaultBranch, 1);
  if (existingCommits.length) {
    throw new Error(
      'Repository already has content. Create a new repo to import.',
    );
  }

  await importRemoteRepo(repoDir, job.importUrl);

  const branches = await listBranches(repoDir);
  if (!branches.length) {
    throw new Error('Remote repository is empty.');
  }

  const desiredBranch = job.branch?.trim();
  const branchNames = branches.map((branch) => branch.name);
  let nextDefaultBranch =
    desiredBranch && branchNames.includes(desiredBranch)
      ? desiredBranch
      : branchNames.includes('main')
        ? 'main'
        : branchNames.includes('master')
          ? 'master'
          : branchNames[0];

  try {
    await setRepoHead(repoDir, nextDefaultBranch);
  } catch {
    nextDefaultBranch = job.repo.defaultBranch;
  }

  if (nextDefaultBranch && nextDefaultBranch !== job.repo.defaultBranch) {
    await prisma.repo.update({
      where: { id: job.repoId },
      data: { defaultBranch: nextDefaultBranch },
    });
  }

  await prisma.repoImportJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      importedBranches: branchNames.length,
      defaultBranch: nextDefaultBranch,
    },
  });
}

