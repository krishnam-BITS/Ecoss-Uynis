import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 20 * 1024 * 1024;
const LANGUAGE_CACHE_TTL_MS = 30 * 1000;

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hh': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.scala': 'Scala',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.ps1': 'PowerShell',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.sql': 'SQL',
  '.json': 'JSON',
  '.jsonc': 'JSON',
  '.json5': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.txt': 'Text',
};

const FILENAME_LANGUAGE_MAP: Record<string, string> = {
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  'cmakelists.txt': 'CMake',
  gemfile: 'Ruby',
  rakefile: 'Ruby',
  procfile: 'Procfile',
  license: 'Text',
  readme: 'Markdown',
};

const LANGUAGE_COLOR_MAP: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Java: '#b07219',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Ruby: '#701516',
  PHP: '#4f5d95',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Scala: '#c22d40',
  Shell: '#89e051',
  PowerShell: '#012456',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Sass: '#a53b70',
  Less: '#1d365d',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  SQL: '#e38c00',
  JSON: '#292929',
  YAML: '#cb171e',
  TOML: '#9c4221',
  XML: '#0060ac',
  Markdown: '#083fa1',
  MDX: '#1b1f24',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  CMake: '#064f8c',
  Procfile: '#3b2f63',
  Text: '#8b949e',
  Other: '#8b949e',
};

const repoLanguageCache = new Map<
  string,
  {
    expiresAt: number;
    summary: RepoLanguageSummary;
  }
>();

export type BranchInfo = {
  name: string;
  sha: string;
};

export type CommitInfo = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

export type RepoLanguage = {
  language: string;
  bytes: number;
  percent: number;
  color: string;
};

export type RepoLanguageSummary = {
  totalBytes: number;
  languages: RepoLanguage[];
};

export async function getRepoDir(
  rootDir: string,
  workspaceSlug: string,
  repoSlug: string,
): Promise<string> {
  const repoDir = path.join(rootDir, workspaceSlug, `${repoSlug}.git`);
  await access(repoDir);
  return repoDir;
}

export async function listBranches(repoDir: string): Promise<BranchInfo[]> {
  const { stdout } = await execFileAsync('git', [
    '--git-dir',
    repoDir,
    'for-each-ref',
    'refs/heads',
    '--format=%(refname:short)\t%(objectname)',
  ]);

  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsedBranches = trimmed
    .split(/\r?\n/)
    .map((line) => {
      const parsed = /^(.*?)(?:\t|%x1f|\x1f)([0-9a-f]{8,64})$/i.exec(line.trim());
      if (!parsed) {
        const fallbackName = line
          .trim()
          .replace(/^refs\/heads\//, '')
          .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}$/gi, '')
          .trim();
        return fallbackName ? { name: fallbackName, sha: '' } : null;
      }
      const cleanName = parsed[1]
        .replace(/^refs\/heads\//, '')
        .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}$/gi, '')
        .trim();
      if (!cleanName) {
        return null;
      }
      return { name: cleanName, sha: parsed[2] };
    })
    .filter((branch): branch is BranchInfo => Boolean(branch));

  const deduped = new Map<string, BranchInfo>();
  for (const branch of parsedBranches) {
    if (!deduped.has(branch.name)) {
      deduped.set(branch.name, branch);
    }
  }
  return Array.from(deduped.values());
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
      .filter(Boolean)
      .map((record) => {
        const [sha, author, date, message] = record.split('\x1f');
        return { sha, author, date, message };
      });
  } catch {
    return [];
  }
}

function normalizeLanguageFromPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();
  const fileName = path.basename(normalizedPath);
  const directLanguage = FILENAME_LANGUAGE_MAP[fileName];
  if (directLanguage) {
    return directLanguage;
  }
  if (fileName.startsWith('readme.')) {
    return 'Markdown';
  }

  const extension = path.extname(fileName);
  if (extension) {
    return EXTENSION_LANGUAGE_MAP[extension] ?? 'Other';
  }

  return 'Other';
}

function normalizeLanguageColor(language: string): string {
  return LANGUAGE_COLOR_MAP[language] ?? LANGUAGE_COLOR_MAP.Other;
}

function getCacheKey(repoDir: string, branch: string): string {
  return `${repoDir}::${branch.trim()}`;
}

function toLanguageSummary(
  languageBytes: Map<string, number>,
  totalBytes: number,
  maxLanguages: number,
): RepoLanguageSummary {
  if (!totalBytes || !languageBytes.size) {
    return { totalBytes: 0, languages: [] };
  }

  const sorted = Array.from(languageBytes.entries())
    .filter(([, bytes]) => bytes > 0)
    .sort((left, right) => right[1] - left[1]);
  const capped = sorted.slice(0, Math.max(1, maxLanguages));
  const overflowBytes = sorted
    .slice(capped.length)
    .reduce((sum, [, bytes]) => sum + bytes, 0);

  if (overflowBytes > 0) {
    const otherIndex = capped.findIndex(([language]) => language === 'Other');
    if (otherIndex >= 0) {
      capped[otherIndex] = ['Other', capped[otherIndex][1] + overflowBytes];
    } else {
      capped.push(['Other', overflowBytes]);
    }
  }

  const languages = capped.map(([language, bytes]) => ({
    language,
    bytes,
    percent: Number(((bytes / totalBytes) * 100).toFixed(1)),
    color: normalizeLanguageColor(language),
  }));

  return { totalBytes, languages };
}

export async function getRepoLanguageSummary(
  repoDir: string,
  branch: string,
  maxLanguages = 6,
): Promise<RepoLanguageSummary> {
  const cleanBranch = branch.trim();
  if (!cleanBranch) {
    return { totalBytes: 0, languages: [] };
  }

  const cacheKey = getCacheKey(repoDir, cleanBranch);
  const now = Date.now();
  const cached = repoLanguageCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.summary;
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['--git-dir', repoDir, 'ls-tree', '-r', '-l', '-z', cleanBranch],
      { maxBuffer: GIT_MAX_BUFFER },
    );
    const output = String(stdout);
    if (!output.trim()) {
      const summary = { totalBytes: 0, languages: [] };
      repoLanguageCache.set(cacheKey, {
        summary,
        expiresAt: now + LANGUAGE_CACHE_TTL_MS,
      });
      return summary;
    }

    const languageBytes = new Map<string, number>();
    let totalBytes = 0;

    const rows = output.split('\0').filter(Boolean);
    for (const row of rows) {
      const match = row.match(
        /^([0-9]+)\s+(blob|tree)\s+([0-9a-f]{40})\s+([0-9-]+)\t(.+)$/,
      );
      if (!match) {
        continue;
      }
      const [, , type, , sizeToken, filePath] = match;
      if (type !== 'blob' || sizeToken === '-') {
        continue;
      }

      const fileBytes = Number.parseInt(sizeToken, 10);
      if (!Number.isFinite(fileBytes) || fileBytes <= 0) {
        continue;
      }

      const language = normalizeLanguageFromPath(filePath);
      languageBytes.set(language, (languageBytes.get(language) ?? 0) + fileBytes);
      totalBytes += fileBytes;
    }

    const summary = toLanguageSummary(languageBytes, totalBytes, maxLanguages);
    repoLanguageCache.set(cacheKey, {
      summary,
      expiresAt: now + LANGUAGE_CACHE_TTL_MS,
    });
    return summary;
  } catch {
    return { totalBytes: 0, languages: [] };
  }
}

