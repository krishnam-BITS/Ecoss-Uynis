import { normalizeRepoPath, readRepoBlob } from './git-engine.js';

const codeownersPaths = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];

export type CodeownerRule = {
  pattern: string;
  owners: string[];
};

export type CodeownersFile = {
  path: string;
  rules: CodeownerRule[];
};

function globToRegex(pattern: string, anchored: boolean): RegExp {
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    const next = pattern[i + 1];
    if (char === '*') {
      if (next === '*') {
        regex += '.*';
        i += 2;
        continue;
      }
      regex += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      i += 1;
      continue;
    }
    if ('\\.[]{}()+-^$|'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
    i += 1;
  }

  if (anchored) {
    return new RegExp(`^${regex}$`);
  }

  return new RegExp(`(^|.*/)${regex}$`);
}

function matchRule(pattern: string, filePath: string): boolean {
  const normalizedPath = normalizeRepoPath(filePath);
  if (!normalizedPath) {
    return false;
  }

  let workingPattern = pattern.trim();
  if (!workingPattern || workingPattern.startsWith('#')) {
    return false;
  }

  if (workingPattern.startsWith('!')) {
    return false;
  }

  const anchored = workingPattern.startsWith('/');
  if (anchored) {
    workingPattern = workingPattern.slice(1);
  }

  if (workingPattern.endsWith('/')) {
    workingPattern = `${workingPattern}**`;
  }

  const regex = globToRegex(workingPattern, anchored);
  return regex.test(normalizedPath);
}

export function parseCodeowners(content: string): CodeownerRule[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/).filter(Boolean))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      pattern: parts[0],
      owners: parts.slice(1),
    }));
}

export function findOwnersForPath(
  rules: CodeownerRule[],
  filePath: string,
): string[] {
  let owners: string[] = [];
  for (const rule of rules) {
    if (matchRule(rule.pattern, filePath)) {
      owners = rule.owners;
    }
  }
  return owners;
}

export async function loadCodeowners(
  repoDir: string,
  branch: string,
): Promise<CodeownersFile | null> {
  for (const filePath of codeownersPaths) {
    const blob = await readRepoBlob(repoDir, branch, filePath);
    if (blob?.content) {
      const rules = parseCodeowners(blob.content);
      return { path: filePath, rules };
    }
  }
  return null;
}