#!/usr/bin/env node
import path from 'node:path';
import { prisma } from '@uynis/db';

function branchPatternMatches(pattern, branchName) {
  const normalizedPattern = pattern.trim();
  const normalizedBranch = branchName.trim();
  if (!normalizedPattern || !normalizedBranch) {
    return false;
  }
  if (normalizedPattern === normalizedBranch) {
    return true;
  }
  const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^${escaped.replace(/\\\*/g, '.*')}$`);
  return regex.test(normalizedBranch);
}

function branchRuleScore(rule) {
  const pattern = rule.pattern.trim();
  const wildcardCount = (pattern.match(/\*/g) ?? []).length;
  const literalLength = pattern.replace(/\*/g, '').length;
  const exactBonus = wildcardCount === 0 ? 1000 : 0;
  return exactBonus + literalLength * 10 - wildcardCount;
}

function selectBranchRule(rules, branchName) {
  const matching = rules.filter((rule) => branchPatternMatches(rule.pattern, branchName));
  if (!matching.length) {
    return null;
  }
  return matching.sort((left, right) => {
    const scoreDiff = branchRuleScore(right) - branchRuleScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const leftUpdated = left.updatedAt?.getTime?.() ?? 0;
    const rightUpdated = right.updatedAt?.getTime?.() ?? 0;
    return rightUpdated - leftUpdated;
  })[0];
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
  });
}

function resolveRepoFromPaths(repoRoot, gitDir) {
  const resolvedGitDir = path.resolve(gitDir);
  const resolvedRoot = path.resolve(repoRoot);

  const relative = path.relative(resolvedRoot, resolvedGitDir);
  if (relative && !relative.startsWith('..')) {
    const parts = relative.split(path.sep).filter(Boolean);
    const workspaceSlug = parts[0];
    const repoSlug = parts[1]?.replace(/\.git$/, '');
    if (workspaceSlug && repoSlug) {
      return { workspaceSlug, repoSlug };
    }
  }

  const pathParts = resolvedGitDir.split(path.sep).filter(Boolean);
  for (let index = pathParts.length - 1; index >= 1; index -= 1) {
    const candidate = pathParts[index];
    if (!candidate.endsWith('.git')) {
      continue;
    }

    const workspaceSlug = pathParts[index - 1];
    const repoSlug = candidate.replace(/\.git$/, '');
    if (workspaceSlug && repoSlug) {
      return { workspaceSlug, repoSlug };
    }
  }

  return null;
}

async function main() {
  const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
  const gitDir = process.env.GIT_DIR || process.cwd();
  const repoLocation = resolveRepoFromPaths(repoRoot, gitDir);
  if (!repoLocation) {
    console.error('Unable to resolve repository for branch rules.');
    process.exit(1);
    return;
  }
  const { workspaceSlug, repoSlug } = repoLocation;

  const repo = await prisma.repo.findFirst({
    where: { slug: repoSlug, workspace: { slug: workspaceSlug } },
    select: { id: true },
  });

  if (!repo) {
    console.error('Repository not found.');
    process.exit(1);
    return;
  }

  const rules = await prisma.branchRule.findMany({
    where: { repoId: repo.id },
    select: {
      pattern: true,
      requirePr: true,
      requireCodeOwners: true,
      blockDirectPush: true,
      requiredChecks: true,
      updatedAt: true,
    },
  });

  const hasRequiredChecks = rules.some((rule) => rule.requiredChecks?.length);
  const payload = await readStdin();
  const updates = payload
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [oldSha, newSha, refName] = line.split(/\s+/);
      return { oldSha, newSha, refName };
    });

  const blockedBranches = [];
  const failedChecks = [];
  for (const update of updates) {
    if (!update.refName?.startsWith('refs/heads/')) {
      continue;
    }
    if (!update.newSha || /^0+$/.test(update.newSha)) {
      continue;
    }
    const branch = update.refName.slice('refs/heads/'.length);
    const rule = selectBranchRule(rules, branch);
    if (rule && (rule.blockDirectPush || rule.requirePr || rule.requireCodeOwners)) {
      blockedBranches.push(branch);
      continue;
    }

    if (rule && rule.requiredChecks?.length) {
      const checks = await prisma.commitCheck.findMany({
        where: {
          repoId: repo.id,
          commitSha: update.newSha.toLowerCase(),
          context: { in: rule.requiredChecks },
        },
        select: {
          context: true,
          status: true,
        },
      });
      const byContext = new Map(
        checks.map((check) => [check.context.toLowerCase(), check.status]),
      );
      const missing = rule.requiredChecks.filter((context) => {
        const status = byContext.get(context.toLowerCase());
        return status !== 'SUCCESS';
      });
      if (missing.length) {
        failedChecks.push({
          branch,
          missing,
        });
      }
    }
  }

  if (blockedBranches.length) {
    console.error(
      `Direct pushes are blocked for: ${blockedBranches.join(', ')}. Open a pull request instead.`,
    );
    process.exit(1);
    return;
  }

  if (hasRequiredChecks && failedChecks.length) {
    const details = failedChecks
      .map((entry) => `${entry.branch}: ${entry.missing.join(', ')}`)
      .join(' | ');
    console.error(`Missing required checks: ${details}.`);
    process.exit(1);
    return;
  }

  process.exit(0);
}

main()
  .catch((error) => {
    console.error(error?.message || 'Unable to validate push.');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

