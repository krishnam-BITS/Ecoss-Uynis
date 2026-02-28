'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../../components/AppShell';
import { RepoHeader } from '../../../../../components/RepoHeader';
import {
  PortalCardSkeleton,
  PortalEmptyState,
  PortalPage,
} from '../../../../../components/portal';
import { PortalToast } from '../../../../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../../../../lib/api';
import { getToken } from '../../../../../lib/auth';
import { Button, Card, InlineFormRow, Modal } from '../../../../../src/components/ui';

const RepoRichMarkdown = dynamic(
  () =>
    import('../../../../../components/repo-detail/RichMarkdown').then(
      (module) => module.RepoRichMarkdown,
    ),
  {
    ssr: false,
    loading: () => <p className="muted">Rendering markdown preview...</p>,
  },
);

const RepoCodeEditor = dynamic(
  () =>
    import('../../../../../components/repo-detail/CodeEditor').then(
      (module) => module.RepoCodeEditor,
    ),
  {
    ssr: false,
    loading: () => <p className="muted">Loading editor...</p>,
  },
);

type RepoLanguage = {
  language: string;
  bytes: number;
  percent: number;
  color?: string | null;
};

type Repo = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | 'OWNER' | null;
  publicReadRequiresAuth?: boolean;
  workspace?: {
    slug?: string;
  };
  languages?: RepoLanguage[];
};

type Branch = {
  name: string;
  sha: string;
};

type TreeEntry = {
  mode: string;
  type: 'tree' | 'blob';
  sha: string;
  size: number | null;
  name: string;
  path: string;
};

type RepoBlob = {
  path: string;
  branch: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  contentBase64: string | null;
};

type Commit = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

const README_NAMES = ['readme.md', 'readme.mdx', 'readme.txt', 'readme'];
const LARGE_FILE_PREVIEW_LIMIT = 120_000;
const PREVIEWABLE_TEXT_EXTENSIONS = new Set(['md', 'mdx', 'txt']);
const EXTENSION_LANGUAGE_MAP: Record<string, { language: string; color: string }> = {
  ts: { language: 'TypeScript', color: '#3178c6' },
  tsx: { language: 'TypeScript', color: '#3178c6' },
  js: { language: 'JavaScript', color: '#f1e05a' },
  jsx: { language: 'JavaScript', color: '#f1e05a' },
  json: { language: 'JSON', color: '#8e8e8e' },
  md: { language: 'Markdown', color: '#0f172a' },
  txt: { language: 'Text', color: '#64748b' },
  py: { language: 'Python', color: '#3572a5' },
  go: { language: 'Go', color: '#00add8' },
  rs: { language: 'Rust', color: '#dea584' },
  java: { language: 'Java', color: '#b07219' },
  kt: { language: 'Kotlin', color: '#7f52ff' },
  swift: { language: 'Swift', color: '#f05138' },
  rb: { language: 'Ruby', color: '#701516' },
  php: { language: 'PHP', color: '#4f5d95' },
  css: { language: 'CSS', color: '#563d7c' },
  scss: { language: 'SCSS', color: '#c6538c' },
  html: { language: 'HTML', color: '#e34c26' },
  yml: { language: 'YAML', color: '#cb171e' },
  yaml: { language: 'YAML', color: '#cb171e' },
  sh: { language: 'Shell', color: '#89e051' },
  sql: { language: 'SQL', color: '#e38c00' },
};

const LANGUAGE_NAME_MAP: Record<string, string> = {
  C: 'C',
  H: 'C/C++ Header',
  CPP: 'C++',
  HPP: 'C++ Header',
  M: 'Objective-C / MATLAB',
  HH: 'C++ Header',
  INC: 'Include',
  GF: 'GF',
  MAT: 'MATLAB',
  GOLO: 'Golo',
  V: 'Verilog',
  NCL: 'NCL',
  NIT: 'Nit',
};

function extensionColor(extension: string) {
  if (!extension) {
    return '#64748b';
  }
  let hash = 0;
  for (let index = 0; index < extension.length; index += 1) {
    hash = (hash << 5) - hash + extension.charCodeAt(index);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 62% 52%)`;
}

function normalizeLanguageLabel(rawLabel: string) {
  const label = rawLabel.trim();
  if (!label) {
    return 'Text';
  }
  const upper = label.toUpperCase();
  if (LANGUAGE_NAME_MAP[upper]) {
    return LANGUAGE_NAME_MAP[upper];
  }
  if (/^[A-Z]{1,4}$/.test(label)) {
    return 'Other';
  }
  return label;
}

function parentPath(pathValue: string) {
  const parts = pathValue.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function makeTreeCacheKey(pathValue: string, branch: string) {
  return `${branch}::${pathValue || ''}`;
}

function normalizeQueryValue(rawValue: string | null): string {
  if (!rawValue) {
    return '';
  }
  let next = rawValue.trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!next.includes('%')) {
      break;
    }
    try {
      next = decodeURIComponent(next);
    } catch {
      break;
    }
  }
  return next.replace(/^\/+/, '');
}

function sanitizeBranchName(rawValue: string | null | undefined): string {
  if (!rawValue) {
    return '';
  }
  let next = rawValue.trim();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!next.includes('%')) {
      break;
    }
    try {
      next = decodeURIComponent(next);
    } catch {
      break;
    }
  }
  return next
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}/gi, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/%+$/g, '')
    .trim();
}

function normalizeBranchValue(rawValue: string | null): string {
  const normalized = sanitizeBranchName(normalizeQueryValue(rawValue));
  if (!normalized) {
    return '';
  }
  const withoutQuery = normalized.split('?')[0].split('&')[0].trim();
  return withoutQuery.replace(/%+$/g, '');
}

function readableSize(size: number | null) {
  if (size === null || Number.isNaN(size)) {
    return '-';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return parsed.toLocaleString();
}

function FileTypeIcon({ type }: { type: 'tree' | 'blob' }) {
  if (type === 'tree') {
    return (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M2.5 5.5h6l1.3 1.8h7.7v7.2a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5.2 2.8h6.4l3.2 3.2v10a1.8 1.8 0 0 1-1.8 1.8H5.2A1.8 1.8 0 0 1 3.4 16V4.6a1.8 1.8 0 0 1 1.8-1.8z" />
      <path d="M11.5 2.8V6h3.3" />
    </svg>
  );
}

export default function RepoCodePage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const branchParam = normalizeBranchValue(searchParams.get('branch'));
  const pathParam = normalizeQueryValue(searchParams.get('path'));
  const fileParam = normalizeQueryValue(searchParams.get('file'));
  const rawParam = (searchParams.get('raw') ?? '').trim();
  const viewParam = (searchParams.get('view') ?? '').trim();

  const [repo, setRepo] = useState<Repo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentEntries, setCurrentEntries] = useState<TreeEntry[]>([]);
  const [treeCache, setTreeCache] = useState<Record<string, TreeEntry[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ '': true });
  const [commits, setCommits] = useState<Commit[]>([]);
  const [blob, setBlob] = useState<RepoBlob | null>(null);
  const [readmeBlob, setReadmeBlob] = useState<RepoBlob | null>(null);
  const [allFilePaths, setAllFilePaths] = useState<string[]>([]);
  const [isBuildingFileIndex, setIsBuildingFileIndex] = useState(false);
  const [fileIndexAttempted, setFileIndexAttempted] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [editedFilePath, setEditedFilePath] = useState('');
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write');
  const [viewerMode, setViewerMode] = useState<'code' | 'preview' | 'blame'>('code');
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isQuickCreateOpen, setIsQuickCreateOpen] = useState(false);
  const [quickCreatePath, setQuickCreatePath] = useState('');
  const [quickCreateContent, setQuickCreateContent] = useState('');
  const [quickCreateMessage, setQuickCreateMessage] = useState('Add new file');
  const [quickCreateKind, setQuickCreateKind] = useState<'file' | 'folder'>('file');
  const [isQuickCreating, setIsQuickCreating] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFrom, setNewBranchFrom] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isSettingDefaultBranch, setIsSettingDefaultBranch] = useState(false);
  const [isTreePanelHidden, setIsTreePanelHidden] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const treeCacheRef = useRef<Record<string, TreeEntry[]>>({});

  const activeBranch = useMemo(() => {
    const fallback = sanitizeBranchName(repo?.defaultBranch) || branches[0]?.name || 'main';
    const requested = sanitizeBranchName(branchParam) || fallback;
    if (!branches.length) {
      return requested;
    }
    const directMatch = branches.find(
      (branch) => sanitizeBranchName(branch.name) === requested,
    );
    if (directMatch) {
      return sanitizeBranchName(directMatch.name);
    }
    const trimmedRef = requested.replace(/^refs\/heads\//, '');
    const refMatch = branches.find(
      (branch) => sanitizeBranchName(branch.name) === trimmedRef,
    );
    if (refMatch) {
      return sanitizeBranchName(refMatch.name);
    }
    return sanitizeBranchName(branches[0]?.name) || fallback;
  }, [branchParam, branches, repo?.defaultBranch]);
  const currentPath = fileParam ? parentPath(fileParam) : pathParam;
  const isFileMode = viewParam === 'files' || Boolean(fileParam) || Boolean(pathParam);
  const isRawMode = rawParam === '1';
  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;
  const canWrite =
    repo?.viewerRole === 'WRITE' || repo?.viewerRole === 'ADMIN' || repo?.viewerRole === 'OWNER';
  const canAdmin = repo?.viewerRole === 'ADMIN' || repo?.viewerRole === 'OWNER';
  const hasServerLanguageBreakdown = (repo?.languages ?? []).some((item) => item.percent > 0);

  const updateQuery = useCallback(
    (updates: Record<string, string | null>, history: 'push' | 'replace' = 'push') => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const queryString = next.toString();
      const nextUrl = queryString
        ? `/workspaces/${workspaceId}/repos/${repoId}?${queryString}`
        : `/workspaces/${workspaceId}/repos/${repoId}`;
      const currentQueryString = searchParams.toString();
      const currentUrl = currentQueryString
        ? `/workspaces/${workspaceId}/repos/${repoId}?${currentQueryString}`
        : `/workspaces/${workspaceId}/repos/${repoId}`;
      if (nextUrl === currentUrl) {
        return;
      }
      if (history === 'replace') {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [repoId, router, searchParams, workspaceId],
  );

  useEffect(() => {
    if (!newBranchFrom) {
      setNewBranchFrom(activeBranch);
    }
  }, [activeBranch, newBranchFrom]);

  const openFolder = useCallback(
    (pathValue: string) => {
      updateQuery({
        branch: activeBranch,
        path: pathValue || null,
        file: null,
        raw: null,
        view: 'files',
      });
    },
    [activeBranch, updateQuery],
  );

  const openFile = useCallback(
    (pathValue: string) => {
      updateQuery({
        branch: activeBranch,
        file: pathValue,
        path: parentPath(pathValue) || null,
        raw: null,
        view: 'files',
      });
    },
    [activeBranch, updateQuery],
  );

  const loadTree = useCallback(
    async (targetPath: string, branch: string) => {
      const safeBranch = sanitizeBranchName(branch) || 'main';
      const cacheKey = makeTreeCacheKey(targetPath, safeBranch);
      const existing = treeCacheRef.current[cacheKey];
      if (existing) {
        return existing;
      }

      const query = new URLSearchParams({ branch: safeBranch });
      if (targetPath) {
        query.set('path', targetPath);
      }

      let data: { entries: TreeEntry[] };
      try {
        data = await apiFetch<{ entries: TreeEntry[] }>(
          `/workspaces/${workspaceId}/repos/${repoId}/tree?${query.toString()}`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 15_000,
          },
        );
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.status === 404 || error.status === 500) &&
          targetPath === ''
        ) {
          data = { entries: [] };
        } else {
          throw error;
        }
      }

      treeCacheRef.current = {
        ...treeCacheRef.current,
        [cacheKey]: data.entries,
      };
      setTreeCache(treeCacheRef.current);
      return data.entries;
    },
    [repoId, workspaceId],
  );

  const loadCommitHistory = useCallback(
    async (branch: string) => {
      const safeBranch = sanitizeBranchName(branch) || 'main';
      try {
        const commitData = await apiFetch<{ commits: Commit[] }>(
          `/workspaces/${workspaceId}/repos/${repoId}/commits?branch=${encodeURIComponent(safeBranch)}&limit=30`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 10_000,
          },
        );
        return commitData.commits;
      } catch (commitError) {
        if (
          !(
            commitError instanceof ApiRequestError &&
            (commitError.status === 404 || commitError.status === 500)
          )
        ) {
          setStatus('Commit history is temporarily unavailable.');
        }
        return [] as Commit[];
      }
    },
    [repoId, workspaceId],
  );

  useEffect(() => {
    if (!workspaceId || !repoId) {
      return;
    }

    const loadRepo = async () => {
      setIsLoading(true);
      setError(null);
      setAuthRequired(false);
      setForbidden(false);
      setBlob(null);
      setReadmeBlob(null);
      setCurrentEntries([]);
      setCommits([]);
      setTreeCache({});
      setAllFilePaths([]);
      setFileIndexAttempted(false);
      treeCacheRef.current = {};
      try {
        const repoData = await apiFetch<{ repo: Repo }>(
          `/workspaces/${workspaceId}/repos/${repoId}`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 12_000,
          },
        );
        const normalizedRepo: Repo = {
          ...repoData.repo,
          defaultBranch:
            sanitizeBranchName(repoData.repo.defaultBranch) ||
            repoData.repo.defaultBranch ||
            'main',
        };
        setRepo(normalizedRepo);
        try {
          const branchData = await apiFetch<{ branches: Branch[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/branches`,
            {
              suppressAuthRedirect: true,
              cacheTtlMs: 20_000,
            },
          );
          const nextBranches = branchData.branches
            .map((branch) => ({
              ...branch,
              name: sanitizeBranchName(branch.name),
            }))
            .filter((branch) => branch.name)
            .filter(
              (branch, index, all) =>
                all.findIndex((candidate) => candidate.name === branch.name) === index,
            );
          setBranches(nextBranches);
        } catch {
          const fallbackBranch = sanitizeBranchName(normalizedRepo.defaultBranch);
          setBranches(
            fallbackBranch
              ? [{ name: fallbackBranch, sha: '' }]
              : [],
          );
        }
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to open this repository.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have access to this repository.');
          } else if (err.status === 404) {
            setError('Repository not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load repository.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void loadRepo();
  }, [repoId, workspaceId]);

  useEffect(() => {
    if (!repo) {
      return;
    }

    const loadContent = async () => {
      setIsLoading(true);
      setError(null);
      if (!branches.length) {
        setCurrentEntries([]);
        setCommits([]);
        setIsLoading(false);
        return;
      }

      try {
        const entries = await loadTree(currentPath, activeBranch);
        setCurrentEntries(entries);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 404 && currentPath) {
            // If the currently selected file/folder no longer exists, reset to root.
            updateQuery({ path: null, file: null }, 'replace');
            setStatus('Path no longer exists. Showing repository root.');
            setIsLoading(false);
            return;
          }
          const fallbackBranch = sanitizeBranchName(repo.defaultBranch) || 'main';
          if (
            (err.status === 400 || err.status === 404 || err.status === 500) &&
            fallbackBranch &&
            activeBranch !== fallbackBranch
          ) {
            updateQuery({ branch: fallbackBranch, path: null, file: null }, 'replace');
            setStatus(`Branch "${activeBranch}" is unavailable. Switched to ${fallbackBranch}.`);
            setIsLoading(false);
            return;
          }
          if ((err.status === 404 || err.status === 500) && !currentPath && !fileParam) {
            setCurrentEntries([]);
            setCommits([]);
            setError(null);
            setIsLoading(false);
            return;
          }
          setError(
            err.message || 'Unable to read repository tree.',
          );
        } else {
          setError(err instanceof Error ? err.message : 'Unable to read repository tree.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void loadContent();
  }, [
    activeBranch,
    branches.length,
    currentPath,
    fileParam,
    loadTree,
    repo,
    repoId,
    updateQuery,
    workspaceId,
  ]);

  useEffect(() => {
    if (!repo || !branches.length) {
      setCommits([]);
      return;
    }

    let cancelled = false;
    const loadCommits = async () => {
      const commitItems = await loadCommitHistory(activeBranch);
      if (!cancelled) {
        setCommits(commitItems);
      }
    };

    void loadCommits();
    return () => {
      cancelled = true;
    };
  }, [activeBranch, branches.length, loadCommitHistory, repo]);

  useEffect(() => {
    if (!repo) {
      return;
    }

    const ensureBranchParam = sanitizeBranchName(branchParam.trim());
    if (!ensureBranchParam) {
      updateQuery({ branch: activeBranch }, 'replace');
      return;
    }

    if (
      branches.length &&
      !branches.some((branch) => sanitizeBranchName(branch.name) === ensureBranchParam)
    ) {
      updateQuery({ branch: activeBranch }, 'replace');
    }
  }, [activeBranch, branchParam, branches, repo, updateQuery]);

  useEffect(() => {
    if (!repo) {
      return;
    }
    if (!fileParam) {
      setBlob(null);
      return;
    }

    const loadBlob = async () => {
      try {
        const query = new URLSearchParams({
          branch: activeBranch,
          path: fileParam,
        });
        const data = await apiFetch<{ blob: RepoBlob }>(
          `/workspaces/${workspaceId}/repos/${repoId}/blob?${query.toString()}`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 8_000,
          },
        );
        setBlob(data.blob);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to read file.');
      }
    };

    void loadBlob();
  }, [activeBranch, fileParam, repo, repoId, workspaceId]);

  useEffect(() => {
    if (!blob || blob.isBinary) {
      setEditorValue('');
      setEditedFilePath('');
      setIsEditingFile(false);
      setEditorMode('write');
      setViewerMode('code');
      return;
    }
    setEditorValue(blob.content ?? '');
    setEditedFilePath(blob.path);
    setIsEditingFile(false);
    setEditorMode('write');
    const extension = blob.path.split('.').pop()?.toLowerCase() ?? '';
    setViewerMode(extension === 'md' || extension === 'mdx' ? 'preview' : 'code');
  }, [blob]);

  useEffect(() => {
    if (!repo || isFileMode || currentPath) {
      setReadmeBlob(null);
      return;
    }

    const readmeEntry = currentEntries.find((entry) =>
      entry.type === 'blob' &&
      README_NAMES.includes(entry.name.toLowerCase()),
    );
    if (!readmeEntry) {
      setReadmeBlob(null);
      return;
    }

    const loadReadme = async () => {
      try {
        const query = new URLSearchParams({
          branch: activeBranch,
          path: readmeEntry.path,
        });
        const data = await apiFetch<{ blob: RepoBlob }>(
          `/workspaces/${workspaceId}/repos/${repoId}/blob?${query.toString()}`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 8_000,
          },
        );
        setReadmeBlob(data.blob);
      } catch {
        setReadmeBlob(null);
      }
    };

    void loadReadme();
  }, [activeBranch, currentEntries, currentPath, isFileMode, repo, repoId, workspaceId]);

  useEffect(() => {
    if (!repo) {
      return;
    }

    const ensureTreeChain = async () => {
      const targetPath = isFileMode ? fileParam : currentPath;
      if (!targetPath) {
        setExpandedFolders((prev) => ({ ...prev, '': true }));
        return;
      }

      const parts = targetPath.split('/').filter(Boolean);
      const nextExpanded: Record<string, boolean> = { '': true };
      await loadTree('', activeBranch);

      let pointer = '';
      const folderParts = isFileMode ? parts.slice(0, -1) : parts;
      for (const part of folderParts) {
        pointer = pointer ? `${pointer}/${part}` : part;
        nextExpanded[pointer] = true;
        // eslint-disable-next-line no-await-in-loop
        await loadTree(pointer, activeBranch);
      }

      setExpandedFolders((prev) => ({ ...prev, ...nextExpanded }));
    };

    void ensureTreeChain();
  }, [activeBranch, currentPath, fileParam, isFileMode, loadTree, repo]);

  const buildFileIndex = useCallback(async (force = false) => {
    if (
      isBuildingFileIndex ||
      allFilePaths.length ||
      !repo ||
      hasServerLanguageBreakdown ||
      (!fileParam && !currentPath && currentEntries.length === 0) ||
      (fileIndexAttempted && !force)
    ) {
      return;
    }

    setIsBuildingFileIndex(true);
    setFileIndexAttempted(true);
    try {
      const queue: string[] = [''];
      const visited = new Set<string>();
      const files: string[] = [];
      const maxFiles = 3500;
      const maxDirs = 1500;

      while (queue.length && files.length < maxFiles && visited.size < maxDirs) {
        const nextPath = queue.shift() ?? '';
        if (visited.has(nextPath)) {
          continue;
        }
        visited.add(nextPath);
        // eslint-disable-next-line no-await-in-loop
        const entries = await loadTree(nextPath, activeBranch);
        for (const entry of entries) {
          if (entry.type === 'tree') {
            queue.push(entry.path);
          } else {
            files.push(entry.path);
          }
          if (files.length >= maxFiles) {
            break;
          }
        }
      }
      setAllFilePaths(files.sort((left, right) => left.localeCompare(right)));
    } catch {
      setAllFilePaths([]);
    } finally {
      setIsBuildingFileIndex(false);
    }
  }, [
    activeBranch,
    allFilePaths.length,
    currentEntries.length,
    currentPath,
    fileIndexAttempted,
    fileParam,
    hasServerLanguageBreakdown,
    isBuildingFileIndex,
    loadTree,
    repo,
  ]);

  useEffect(() => {
    if (!repo || isLoading || fileParam || currentPath || hasServerLanguageBreakdown) {
      return;
    }
    if (fileIndexAttempted || isBuildingFileIndex) {
      return;
    }
    if (!currentEntries.length) {
      return;
    }
    void buildFileIndex();
  }, [
    buildFileIndex,
    currentEntries.length,
    currentPath,
    fileIndexAttempted,
    fileParam,
    hasServerLanguageBreakdown,
    isBuildingFileIndex,
    isLoading,
    repo,
  ]);

  const refreshRepositoryState = useCallback(async () => {
    treeCacheRef.current = {};
    setTreeCache({});
    const entries = await loadTree(currentPath, activeBranch);
    const commitItems = await loadCommitHistory(activeBranch);
    setCurrentEntries(entries);
    setCommits(commitItems);
  }, [activeBranch, currentPath, loadCommitHistory, loadTree]);

  const commitChanges = useCallback(
    async (payload: { message: string; changes: Array<{ path: string; content?: string; delete?: boolean }> }) => {
      const safeBranch = sanitizeBranchName(activeBranch) || 'main';
      const data = await apiFetch<{ commit: Commit }>(
        `/workspaces/${workspaceId}/repos/${repoId}/commits`,
        {
          method: 'POST',
          body: JSON.stringify({
            branch: safeBranch,
            message: payload.message,
            changes: payload.changes,
          }),
          suppressAuthRedirect: true,
        },
      );
      await refreshRepositoryState();
      return data.commit;
    },
    [activeBranch, refreshRepositoryState, repoId, workspaceId],
  );

  const collectFolderBlobPaths = useCallback(
    async (folderPath: string) => {
      const normalizedFolder = folderPath.replace(/^\/+/, '').replace(/\/+$/, '');
      if (!normalizedFolder) {
        return [] as string[];
      }

      const queue: string[] = [normalizedFolder];
      const visited = new Set<string>();
      const files: string[] = [];

      while (queue.length) {
        const nextPath = queue.shift() ?? '';
        if (!nextPath || visited.has(nextPath)) {
          continue;
        }
        visited.add(nextPath);
        // eslint-disable-next-line no-await-in-loop
        const entries = await loadTree(nextPath, activeBranch);
        for (const entry of entries) {
          if (entry.type === 'tree') {
            queue.push(entry.path);
          } else {
            files.push(entry.path);
          }
        }
      }

      return files;
    },
    [activeBranch, loadTree],
  );

  const deleteSelectedTarget = useCallback(async () => {
    if (!canWrite) {
      setError('Write access is required to delete files or folders.');
      return;
    }

    const selectedFile = fileParam ? fileParam.replace(/^\/+/, '') : '';
    const selectedFolder =
      !selectedFile && currentPath ? currentPath.replace(/^\/+/, '').replace(/\/+$/, '') : '';

    if (!selectedFile && !selectedFolder) {
      setStatus('Select a file or folder first.');
      return;
    }

    if (selectedFile) {
      const confirmed = window.confirm(`Delete ${selectedFile}? This creates a commit.`);
      if (!confirmed) {
        return;
      }
      setIsSavingFile(true);
      setError(null);
      try {
        const commit = await commitChanges({
          message: `Delete ${selectedFile}`,
          changes: [{ path: selectedFile, delete: true }],
        });
        updateQuery(
          {
            branch: activeBranch,
            file: null,
            path: parentPath(selectedFile) || null,
            raw: null,
            view: 'files',
          },
          'replace',
        );
        setStatus(`Deleted ${selectedFile} (${commit.sha.slice(0, 7)}).`);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 500) {
          setError('Unable to delete file right now. The server rejected the commit; retry in a moment.');
        } else {
          setError(err instanceof Error ? err.message : 'Unable to delete file.');
        }
      } finally {
        setIsSavingFile(false);
      }
      return;
    }

    const files = await collectFolderBlobPaths(selectedFolder);
    if (!files.length) {
      setStatus('Folder is empty. Nothing to delete.');
      return;
    }

    const confirmed = window.confirm(
      `Delete folder ${selectedFolder} and ${files.length} file${files.length === 1 ? '' : 's'}? This creates a commit.`,
    );
    if (!confirmed) {
      return;
    }

    setIsSavingFile(true);
    setError(null);
    try {
      const commit = await commitChanges({
        message: `Delete folder ${selectedFolder}`,
        changes: files.map((pathValue) => ({ path: pathValue, delete: true })),
      });
      updateQuery(
        {
          branch: activeBranch,
          file: null,
          path: parentPath(selectedFolder) || null,
          raw: null,
          view: 'files',
        },
        'replace',
      );
      setStatus(
        `Deleted folder ${selectedFolder} (${files.length} file${files.length === 1 ? '' : 's'}, ${commit.sha.slice(0, 7)}).`,
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 500) {
        setError('Unable to delete folder right now. The server rejected the commit; retry in a moment.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to delete folder.');
      }
    } finally {
      setIsSavingFile(false);
    }
  }, [
    activeBranch,
    canWrite,
    collectFolderBlobPaths,
    commitChanges,
    currentPath,
    fileParam,
    updateQuery,
  ]);

  const saveCurrentFile = async () => {
    if (!blob || blob.isBinary || !canWrite) {
      return;
    }
    const nextPath = editedFilePath.trim().replace(/^\/+/, '');
    if (!nextPath || nextPath.includes('..')) {
      setError('Enter a valid file path before saving.');
      return;
    }
    const previous = blob.content ?? '';
    const isRename = nextPath !== blob.path;
    if (editorValue === previous && !isRename) {
      setStatus('No changes to save.');
      return;
    }

    setIsSavingFile(true);
    setError(null);
    try {
      const commit = await commitChanges({
        message: isRename
          ? `Rename ${blob.path} -> ${nextPath}`
          : `Update ${blob.path}`,
        changes: isRename
          ? [
              {
                path: blob.path,
                delete: true,
              },
              {
                path: nextPath,
                content: editorValue,
              },
            ]
          : [
              {
                path: blob.path,
                content: editorValue,
              },
            ],
      });
      const query = new URLSearchParams({
        branch: activeBranch,
        path: nextPath,
      });
      const blobData = await apiFetch<{ blob: RepoBlob }>(
        `/workspaces/${workspaceId}/repos/${repoId}/blob?${query.toString()}`,
        { suppressAuthRedirect: true },
      );
      setBlob(blobData.blob);
      updateQuery({
        branch: activeBranch,
        file: nextPath,
        path: parentPath(nextPath) || null,
        raw: null,
        view: 'files',
      }, 'replace');
      if (!currentPath && README_NAMES.includes(nextPath.toLowerCase())) {
        setReadmeBlob(blobData.blob);
      }
      setIsEditingFile(false);
      setStatus(`Saved ${nextPath} (${commit.sha.slice(0, 7)}).`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError(err.message || 'Commit rejected. Refresh and try again.');
      } else if (err instanceof ApiRequestError && err.status === 500) {
        setError('Unable to save file right now. The server rejected the commit; retry in a moment.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to save file changes.');
      }
    } finally {
      setIsSavingFile(false);
    }
  };

  const createNewFile = async () => {
    if (!canWrite) {
      setError('Write access is required to create files.');
      return;
    }
    const normalizedPath = quickCreatePath.trim().replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.includes('..')) {
      setError('Enter a valid file path.');
      return;
    }

    setIsQuickCreating(true);
    setError(null);
    try {
      const commit = await commitChanges({
        message: quickCreateMessage.trim() || `Add ${normalizedPath}`,
        changes: [
          {
            path: normalizedPath,
            content: quickCreateContent,
          },
        ],
      });
      setStatus(`Created ${normalizedPath} (${commit.sha.slice(0, 7)}).`);
      setIsQuickCreateOpen(false);
      setQuickCreateContent('');
      setQuickCreatePath('');
      setQuickCreateMessage('Add new file');
      setQuickCreateKind('file');
      updateQuery(
        {
          branch: activeBranch,
          view: 'files',
          file: normalizedPath,
          path: parentPath(normalizedPath) || null,
          raw: null,
        },
        'replace',
      );
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 409) {
        setError(err.message || 'Commit rejected. Refresh and try again.');
      } else if (err instanceof ApiRequestError && err.status === 500) {
        setError('Unable to create file right now. The server rejected the commit; retry in a moment.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to create file.');
      }
    } finally {
      setIsQuickCreating(false);
    }
  };

  const openQuickCreateModal = useCallback(
    (kind: 'file' | 'folder') => {
      const basePrefix = currentPath ? `${currentPath}/` : '';
      setQuickCreateKind(kind);
      if (kind === 'folder') {
        setQuickCreatePath(`${basePrefix}new-folder/.gitkeep`);
        setQuickCreateContent('');
        setQuickCreateMessage('Create folder scaffold');
      } else {
        setQuickCreatePath(`${basePrefix}new-file.txt`);
        setQuickCreateContent('');
        setQuickCreateMessage('Add new file');
      }
      setIsQuickCreateOpen(true);
    },
    [currentPath],
  );

  const createBranchFromCurrent = useCallback(async () => {
    const branchName = sanitizeBranchName(newBranchName);
    const sourceBranch = sanitizeBranchName(newBranchFrom || activeBranch);
    if (!branchName) {
      setError('Enter a valid branch name.');
      return;
    }

    setIsCreatingBranch(true);
    setError(null);
    try {
      const data = await apiFetch<{ branch: Branch }>(
        `/workspaces/${workspaceId}/repos/${repoId}/branches`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: branchName,
            fromBranch: sourceBranch,
          }),
          suppressAuthRedirect: true,
        },
      );
      const createdBranch = {
        ...data.branch,
        name: sanitizeBranchName(data.branch.name),
      };
      setBranches((previous) => {
        const filtered = previous.filter(
          (item) => sanitizeBranchName(item.name) !== createdBranch.name,
        );
        return [createdBranch, ...filtered];
      });
      setStatus(`Branch "${createdBranch.name}" created from ${sourceBranch}.`);
      setIsBranchModalOpen(false);
      setNewBranchName('');
      setNewBranchFrom(createdBranch.name);
      updateQuery({
        branch: createdBranch.name,
        file: null,
        path: null,
        raw: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create branch.');
    } finally {
      setIsCreatingBranch(false);
    }
  }, [activeBranch, newBranchFrom, newBranchName, repoId, updateQuery, workspaceId]);

  const setActiveBranchAsDefault = useCallback(async () => {
    if (!repo) {
      return;
    }
    setIsSettingDefaultBranch(true);
    setError(null);
    try {
      const data = await apiFetch<{ repo: Repo }>(
        `/workspaces/${workspaceId}/repos/${repoId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            defaultBranch: activeBranch,
          }),
          suppressAuthRedirect: true,
        },
      );
      setRepo((previous) => {
        const nextRepo = {
          ...(previous ?? {}),
          ...data.repo,
        } as Repo;
        nextRepo.defaultBranch =
          sanitizeBranchName(nextRepo.defaultBranch) || nextRepo.defaultBranch || activeBranch;
        return nextRepo;
      });
      setStatus(`Default branch set to ${activeBranch}.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to update default branch.',
      );
    } finally {
      setIsSettingDefaultBranch(false);
    }
  }, [activeBranch, repo, repoId, workspaceId]);

  const lineItems = useMemo(() => {
    if (!blob?.content || blob.isBinary) {
      return [];
    }
    if (!isRawMode && blob.content.length > LARGE_FILE_PREVIEW_LIMIT) {
      return blob.content.slice(0, LARGE_FILE_PREVIEW_LIMIT).split('\n');
    }
    return blob.content.split('\n');
  }, [blob, isRawMode]);

  const isLargeTextBlob = useMemo(() => {
    if (!blob || blob.isBinary || !blob.content) {
      return false;
    }
    return blob.content.length > LARGE_FILE_PREVIEW_LIMIT;
  }, [blob]);

  const activeFileExtension = useMemo(() => {
    if (!blob?.path) {
      return '';
    }
    return blob.path.split('.').pop()?.toLowerCase() ?? '';
  }, [blob?.path]);

  const isMarkdownFile = activeFileExtension === 'md' || activeFileExtension === 'mdx';
  const isPlainTextFile = activeFileExtension === 'txt';
  const canPreviewReadMode = PREVIEWABLE_TEXT_EXTENSIONS.has(activeFileExtension);
  const canBlameReadMode = !canPreviewReadMode;
  const isJsonFile = activeFileExtension === 'json';

  const pathSegments = useMemo(() => {
    const targetPath = isFileMode ? fileParam : currentPath;
    if (!targetPath) {
      return [] as Array<{ label: string; value: string }>;
    }
    const parts = targetPath.split('/').filter(Boolean);
    return parts.map((segment, index) => ({
      label: segment,
      value: parts.slice(0, index + 1).join('/'),
    }));
  }, [currentPath, fileParam, isFileMode]);

  const breadcrumbSegments = useMemo(() => {
    const segments: Array<{ label: string; href?: string; onClick?: () => void; active?: boolean }> = [
      {
        label: repo?.name ?? repoRef,
        href: `/workspaces/${repoWorkspaceRef}/repos/${repoRef}?branch=${encodeURIComponent(activeBranch)}`,
        active: !isFileMode && !pathSegments.length,
      },
    ];

    if (isFileMode) {
      for (const segment of pathSegments) {
        const segmentIsFile = segment.value === fileParam;
        segments.push({
          label: segment.label,
          active: segmentIsFile,
          onClick: () => {
            if (segmentIsFile) {
              openFile(segment.value);
              return;
            }
            openFolder(segment.value);
          },
        });
      }
      return segments;
    }

    for (const segment of pathSegments) {
      segments.push({
        label: segment.label,
        active: segment.value === currentPath,
        onClick: () => openFolder(segment.value),
      });
    }

    return segments;
  }, [
    activeBranch,
    currentPath,
    fileParam,
    isFileMode,
    openFile,
    openFolder,
    pathSegments,
    repo?.name,
    repoRef,
    repoWorkspaceRef,
  ]);

  const fallbackLanguageItems = useMemo<RepoLanguage[]>(() => {
    if (!allFilePaths.length) {
      return [];
    }

    const counts = new Map<string, { language: string; color?: string; amount: number }>();
    for (const pathValue of allFilePaths) {
      const extension = pathValue.split('.').pop()?.toLowerCase() ?? '';
      const mapped = EXTENSION_LANGUAGE_MAP[extension];
      const language = mapped?.language ?? (extension ? `.${extension}` : 'Text');
      const color = mapped?.color ?? extensionColor(extension);
      const current = counts.get(language);
      if (current) {
        current.amount += 1;
      } else {
        counts.set(language, {
          language,
          color,
          amount: 1,
        });
      }
    }

    const total = Array.from(counts.values()).reduce((sum, item) => sum + item.amount, 0);
    if (!total) {
      return [];
    }

    return Array.from(counts.values())
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 12)
      .map((item) => ({
        language: normalizeLanguageLabel(item.language),
        bytes: item.amount,
        percent: (item.amount / total) * 100,
        color: item.color,
      }));
  }, [allFilePaths]);

  const normalizedRepoLanguages = useMemo<RepoLanguage[]>(() => {
    const source = (repo?.languages ?? []).filter((item) => item.percent > 0);
    if (!source.length) {
      return [];
    }

    const buckets = new Map<string, RepoLanguage>();
    for (const item of source) {
      const language = normalizeLanguageLabel(item.language);
      const key = language.toLowerCase();
      const existing = buckets.get(key);
      if (existing) {
        existing.bytes += item.bytes;
        existing.percent += item.percent;
      } else {
        buckets.set(key, {
          language,
          bytes: item.bytes,
          percent: item.percent,
          color: item.color || extensionColor(language.toLowerCase()),
        });
      }
    }

    const merged = Array.from(buckets.values()).sort((left, right) => right.percent - left.percent);
    const primary = merged.filter((item) => item.language !== 'Other').slice(0, 10);
    const otherPercent = merged
      .filter((item) => item.language === 'Other')
      .reduce((sum, item) => sum + item.percent, 0);
    if (otherPercent > 0.4) {
      primary.push({
        language: 'Other',
        bytes: 0,
        percent: otherPercent,
        color: '#94a3b8',
      });
    }
    return primary;
  }, [repo?.languages]);

  const languageItems = useMemo(() => {
    if (normalizedRepoLanguages.length) {
      return normalizedRepoLanguages;
    }
    if (fileIndexAttempted && fallbackLanguageItems.length) {
      return fallbackLanguageItems;
    }
    return [];
  }, [fallbackLanguageItems, fileIndexAttempted, normalizedRepoLanguages]);
  const latestCommit = commits[0] ?? null;

  const renderTree = (dirPath: string, depth = 0) => {
    const entries = treeCache[makeTreeCacheKey(dirPath, activeBranch)] ?? [];
    if (!entries.length) {
      return null;
    }
    return (
      <ul className="repo-tree-list">
        {entries.map((entry) => {
          if (entry.type === 'tree') {
            const expanded = Boolean(expandedFolders[entry.path]);
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`repo-tree-node repo-tree-folder ${expanded ? 'is-expanded' : ''}`}
                  style={{ paddingLeft: `${8 + depth * 12}px` }}
                  onClick={() => {
                    const nextExpanded = !expanded;
                    setExpandedFolders((prev) => ({
                      ...prev,
                      [entry.path]: nextExpanded,
                    }));
                    if (nextExpanded) {
                      void loadTree(entry.path, activeBranch);
                    }
                  }}
                >
                  <span className="repo-tree-chevron" aria-hidden="true"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8">{expanded ? <path d="M2.4 4.2 6 7.8l3.6-3.6" /> : <path d="M4.2 2.4 7.8 6l-3.6 3.6" />}</svg></span>
                  <span className="repo-tree-entry-icon" aria-hidden="true">
                    <FileTypeIcon type="tree" />
                  </span>
                  <span>{entry.name}</span>
                </button>
                {expanded ? renderTree(entry.path, depth + 1) : null}
              </li>
            );
          }
          return (
            <li key={entry.path}>
              <button
                type="button"
                className={`repo-tree-node repo-tree-file ${fileParam === entry.path ? 'is-active' : ''}`}
                style={{ paddingLeft: `${24 + depth * 12}px` }}
                onClick={() => openFile(entry.path)}
              >
                <span className="repo-tree-entry-icon" aria-hidden="true">
                  <FileTypeIcon type="blob" />
                </span>
                {entry.name}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  const renderListView = () => (
    <section className="repo-code-layout">
      <div className="repo-code-main">
        <Card className="repo-file-table-card">
          {currentEntries.length ? (
            <table className="repo-file-table">
              <thead>
                <tr>
                  <th className="repo-file-head-primary">Name</th>
                  <th>Last commit</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {currentEntries.map((entry) => (
                  <tr key={entry.path}>
                    <td>
                      <button
                        type="button"
                        className={`repo-file-link ${entry.type}`}
                        onClick={() =>
                          entry.type === 'tree' ? openFolder(entry.path) : openFile(entry.path)
                        }
                      >
                        <span className="repo-file-icon" aria-hidden="true">
                          <FileTypeIcon type={entry.type} />
                        </span>
                        <span>{entry.name}</span>
                      </button>
                    </td>
                    <td>
                      {latestCommit ? (
                        <span className="muted">{latestCommit.message}</span>
                      ) : (
                        <span className="muted">No commits yet</span>
                      )}
                    </td>
                    <td>
                      <span className="muted">
                        {latestCommit ? formatDateTime(latestCommit.date) : '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <PortalEmptyState message="No files found in this path." />
          )}
          </Card>

        {readmeBlob?.content && !readmeBlob.isBinary ? (
          <Card className="repo-readme-card">
            <header className="repo-readme-head">
              <div className="repo-readme-head-copy">
                <h3>README</h3>
                <span className="muted">{readmeBlob.path}</span>
              </div>
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openFile(readmeBlob.path)}
                >
                  Edit README
                </Button>
              ) : null}
            </header>
            <div className="repo-readme-content">
              <RepoRichMarkdown markdown={readmeBlob.content.slice(0, 80_000)} />
            </div>
          </Card>
        ) : !currentPath ? (
          <Card className="repo-readme-card">
            <header className="repo-readme-head">
              <div className="repo-readme-head-copy">
                <h3>README</h3>
              </div>
              {canWrite ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuickCreateKind('file');
                    setQuickCreatePath('README.md');
                    setQuickCreateContent('# Repository\n\nDescribe your project here.\n');
                    setQuickCreateMessage('Add README');
                    setIsQuickCreateOpen(true);
                  }}
                >
                  Create README
                </Button>
              ) : null}
            </header>
            <p className="muted">No README found in this repository root.</p>
          </Card>
        ) : null}
      </div>

    </section>
  );

  const renderFileView = () => (
    <>
      <div className="repo-file-mode-toolbar card canvas-card">
        <InlineFormRow align="start" className="repo-file-mode-toolbar-row">
          <Button
            type="button"
            className="repo-tree-toggle-btn"
            variant={isTreePanelHidden ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setIsTreePanelHidden((current) => !current)}
            aria-label={isTreePanelHidden ? 'Show file tree' : 'Hide file tree'}
            title={isTreePanelHidden ? 'Show file tree' : 'Hide file tree'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <path d="M9.5 4.5v15" />
              <path d="M6.5 8h1.2" />
              <path d="M6.5 12h1.2" />
              <path d="M6.5 16h1.2" />
              <path d="M12.5 9h5" />
              <path d="M12.5 13h5" />
            </svg>
          </Button>
          <select
            className="repo-branch-select"
            value={activeBranch}
            onChange={(event) => {
              updateQuery({
                branch: sanitizeBranchName(event.target.value),
              });
            }}
            aria-label="Select branch"
          >
            {branches.length ? (
              branches.map((branch) => (
                <option key={branch.name} value={sanitizeBranchName(branch.name)}>
                  {sanitizeBranchName(branch.name)}
                </option>
              ))
            ) : (
              <option value={activeBranch}>{activeBranch}</option>
            )}
          </select>
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setNewBranchFrom(activeBranch);
                setNewBranchName('');
                setIsBranchModalOpen(true);
              }}
            >
              Branch
            </Button>
          ) : null}
          {canWrite ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="repo-file-add-btn"
              aria-label="Create file or folder"
              onClick={() => openQuickCreateModal('file')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => updateQuery({ view: null, path: null, file: null, raw: null })}
          >
            Exit
          </Button>
        </InlineFormRow>
      </div>
      <section
        className={`repo-file-viewer-layout ${
          isTreePanelHidden ? 'repo-file-viewer-layout--tree-hidden' : ''
        }`.trim()}
      >
        {!isTreePanelHidden ? (
          <aside className="repo-tree-panel card canvas-card">
            <header className="repo-tree-head">
              <h3>Files</h3>
            </header>
            <div className="repo-tree-scroll">{renderTree('', 0)}</div>
          </aside>
        ) : null}
        <article className="repo-editor-panel card canvas-card">
          <header className="repo-editor-head">
            <div className={`repo-path-crumbs ${isEditingFile ? 'repo-path-crumbs--editing' : 'repo-path-crumbs--plain'}`}>
              <span className="repo-path-crumb">
                <button type="button" className="repo-path-link" onClick={() => openFolder('')}>
                  {repo?.name ?? repoRef}
                </button>
              </span>
              {pathSegments.map((segment) => {
                const segmentIsFile = segment.value === fileParam;
                const segmentIsEditable = segmentIsFile && isEditingFile;
                return (
                  <span key={segment.value} className="repo-path-crumb">
                    <span className="repo-path-separator" aria-hidden="true">
                      /
                    </span>
                    {segmentIsEditable ? (
                      <input
                        className="repo-path-input"
                        value={editedFilePath.split('/').pop() ?? segment.label}
                        onChange={(event) => {
                          const nextFileName = event.target.value.replace(/[\\/]/g, '');
                          const nextParent = parentPath(fileParam);
                          setEditedFilePath(nextParent ? `${nextParent}/${nextFileName}` : nextFileName);
                        }}
                        aria-label="File name"
                      />
                    ) : (
                      <button
                        type="button"
                        className={`repo-path-link ${segmentIsFile ? 'active' : ''}`}
                        onClick={() => {
                          if (segmentIsFile) {
                            openFile(segment.value);
                            return;
                          }
                          openFolder(segment.value);
                        }}
                      >
                        {segment.label}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
            <InlineFormRow align="start">
              {blob && !blob.isBinary && !isEditingFile && canPreviewReadMode ? (
                <InlineFormRow align="start" className="repo-view-mode-toggle">
                  <Button
                    type="button"
                    variant={viewerMode === 'code' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewerMode('code')}
                  >
                    Code
                  </Button>
                  <Button
                    type="button"
                    variant={viewerMode === 'preview' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewerMode('preview')}
                  >
                    Preview
                  </Button>
                </InlineFormRow>
              ) : null}
              {blob && !blob.isBinary && !isEditingFile && canBlameReadMode ? (
                <InlineFormRow align="start" className="repo-view-mode-toggle">
                  <Button
                    type="button"
                    variant={viewerMode === 'code' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewerMode('code')}
                  >
                    Code
                  </Button>
                  <Button
                    type="button"
                    variant={viewerMode === 'blame' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setViewerMode('blame')}
                  >
                    Blame
                  </Button>
                </InlineFormRow>
              ) : null}
              {blob && !blob.isBinary ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(blob.content ?? '');
                      setStatus('File content copied.');
                    } catch {
                      setError('Unable to copy file content.');
                    }
                  }}
                >
                  Copy
                </Button>
              ) : null}
              {blob && !blob.isBinary ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      const fileBlob = new Blob([blob.content ?? ''], {
                        type: 'text/plain;charset=utf-8',
                      });
                      const objectUrl = URL.createObjectURL(fileBlob);
                      const anchor = document.createElement('a');
                      anchor.href = objectUrl;
                      anchor.download = blob.path.split('/').pop() || 'file.txt';
                      document.body.appendChild(anchor);
                      anchor.click();
                      anchor.remove();
                      URL.revokeObjectURL(objectUrl);
                      setStatus('File downloaded.');
                    } catch {
                      setError('Unable to download file.');
                    }
                  }}
                >
                  Download
                </Button>
              ) : null}
              {blob && !blob.isBinary && canWrite ? (
                <Button
                  type="button"
                  variant={isEditingFile ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    if (isEditingFile) {
                      setIsEditingFile(false);
                      setEditorValue(blob.content ?? '');
                      setEditedFilePath(blob.path);
                      setEditorMode('write');
                      return;
                    }
                    setEditedFilePath(blob.path);
                    setIsEditingFile(true);
                    setEditorMode('write');
                  }}
                >
                  {isEditingFile ? 'Cancel' : 'Edit'}
                </Button>
              ) : null}
              {blob && !blob.isBinary && canWrite && isEditingFile && (isMarkdownFile || isPlainTextFile) ? (
                <InlineFormRow align="start">
                  <Button
                    type="button"
                    variant={editorMode === 'write' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setEditorMode('write')}
                  >
                    Code
                  </Button>
                  <Button
                    type="button"
                    variant={editorMode === 'preview' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setEditorMode('preview')}
                  >
                    Preview
                  </Button>
                </InlineFormRow>
              ) : null}
              {blob && !blob.isBinary && canWrite && isEditingFile && isJsonFile ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      const parsed = JSON.parse(editorValue || '{}');
                      setEditorValue(`${JSON.stringify(parsed, null, 2)}\n`);
                      setStatus('Formatted JSON.');
                    } catch {
                      setError('Invalid JSON. Fix syntax before formatting.');
                    }
                  }}
                >
                  Format JSON
                </Button>
              ) : null}
              {blob && !blob.isBinary && canWrite && isEditingFile ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  disabled={isSavingFile || editorValue === (blob.content ?? '')}
                  onClick={() => {
                    void saveCurrentFile();
                  }}
                >
                  {isSavingFile ? 'Saving...' : 'Save'}
                </Button>
              ) : null}
              {canWrite && !isEditingFile && (fileParam || currentPath) ? (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={isSavingFile}
                  onClick={() => {
                    void deleteSelectedTarget();
                  }}
                >
                  {fileParam ? 'Delete file' : 'Delete folder'}
                </Button>
              ) : null}
              {isLargeTextBlob ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => updateQuery({ raw: isRawMode ? null : '1' })}
                >
                  {isRawMode ? 'Exit raw' : 'View raw'}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => updateQuery({ file: null, raw: null })}
              >
                {fileParam ? 'Back' : 'Tree'}
              </Button>
            </InlineFormRow>
          </header>

          <div className="repo-editor-body">
          {!fileParam ? (
            <div className="repo-folder-pane">
              <header className="repo-folder-pane-head">
                <h4>{currentPath ? `/${currentPath}` : 'Repository root'}</h4>
              </header>
              <div className="repo-folder-pane-scroll">
                {currentEntries.length ? (
                  <ul className="repo-folder-pane-list">
                    {currentEntries.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className="repo-folder-pane-item"
                          onClick={() => {
                            if (entry.type === 'tree') {
                              openFolder(entry.path);
                              return;
                            }
                            openFile(entry.path);
                          }}
                        >
                          <FileTypeIcon type={entry.type} />
                          <span>{entry.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">This folder is empty.</p>
                )}
              </div>
            </div>
          ) : !blob ? (
            <p className="muted">Loading file...</p>
          ) : blob.isBinary ? (
            <div className="repo-binary-card">
              <p>This file is binary and cannot be rendered as text.</p>
              <p className="muted">
                Path: {blob.path} - Size: {readableSize(blob.size)}
              </p>
            </div>
          ) : isEditingFile ? (
            <div className="repo-code-block-wrap">
              {isMarkdownFile || isPlainTextFile ? (
                <>
                  {editorMode === 'preview' ? (
                    <div className="repo-markdown-preview">
                      {isMarkdownFile ? (
                        <RepoRichMarkdown markdown={editorValue || '_No content_'} />
                      ) : (
                        <pre className="repo-text-preview">{editorValue || ''}</pre>
                      )}
                    </div>
                  ) : (
                    <RepoCodeEditor
                      path={blob.path}
                      value={editorValue}
                      onChange={setEditorValue}
                      minHeight={420}
                    />
                  )}
                </>
              ) : (
                <RepoCodeEditor
                  path={blob.path}
                  value={editorValue}
                  onChange={setEditorValue}
                  minHeight={420}
                />
              )}
            </div>
          ) : (
            <div className="repo-code-block-wrap">
              {isLargeTextBlob && !isRawMode ? (
                <p className="muted repo-code-preview-note">
                  Large file preview: showing first {LARGE_FILE_PREVIEW_LIMIT.toLocaleString()} characters.
                </p>
              ) : null}
              {isRawMode ? (
                <pre className="repo-raw-view">{blob.content ?? ''}</pre>
              ) : viewerMode === 'preview' && canPreviewReadMode ? (
                <div className="repo-markdown-preview repo-file-preview-pane">
                  {isMarkdownFile ? (
                    <RepoRichMarkdown markdown={blob.content ?? '_No content_'} />
                  ) : (
                    <pre className="repo-text-preview">{blob.content ?? ''}</pre>
                  )}
                </div>
              ) : viewerMode === 'blame' && canBlameReadMode ? (
                <div className="repo-blame-view">
                  <p className="muted repo-blame-note">
                    Blame metadata is not available yet in this view. Line mapping is shown for quick review.
                  </p>
                  <table className="repo-code-table repo-blame-table">
                    <tbody>
                      {lineItems.map((line, index) => (
                        <tr key={`${blob.sha}-blame-${index + 1}`}>
                          <td className="repo-blame-meta">
                            {latestCommit ? latestCommit.sha.slice(0, 7) : '-'}
                          </td>
                          <td className="repo-code-line">{index + 1}</td>
                          <td className="repo-code-content">
                            <pre>{line || ' '}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <table className="repo-code-table">
                  <tbody>
                    {lineItems.map((line, index) => (
                      <tr key={`${blob.sha}-${index + 1}`}>
                        <td className="repo-code-line">{index + 1}</td>
                        <td className="repo-code-content">
                          <pre>{line || ' '}</pre>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          </div>
        </article>
      </section>
    </>
  );

  return (
    <AppShell title="Repository">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {status ? <PortalToast message={status} tone="success" onClose={() => setStatus(null)} /> : null}
      {!isFileMode ? (
        <RepoHeader
          workspaceId={workspaceId}
          repoId={repoId}
          repo={repo}
          languages={languageItems}
          commitCount={commits.length}
        />
      ) : null}
      <PortalPage className={`repo-code-shell ${isFileMode ? 'repo-code-shell--file-mode' : ''}`.trim()}>
      {!isFileMode ? (
        <Card className="repo-overview-toolbar">
          <InlineFormRow align="start" className="repo-overview-toolbar-row">
            <select
              className="repo-branch-select"
              value={activeBranch}
              onChange={(event) => {
                updateQuery({
                  branch: sanitizeBranchName(event.target.value),
                });
              }}
              aria-label="Select branch"
            >
              {branches.length ? (
                branches.map((branch) => (
                  <option key={branch.name} value={sanitizeBranchName(branch.name)}>
                    {sanitizeBranchName(branch.name)}
                  </option>
                ))
              ) : (
                <option value={activeBranch}>{activeBranch}</option>
              )}
            </select>
            {canWrite ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setNewBranchFrom(activeBranch);
                  setNewBranchName('');
                  setIsBranchModalOpen(true);
                }}
            >
                New branch
              </Button>
            ) : null}
            {canAdmin && sanitizeBranchName(repo?.defaultBranch) !== activeBranch ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSettingDefaultBranch}
                onClick={() => {
                  void setActiveBranchAsDefault();
                }}
              >
                {isSettingDefaultBranch ? 'Saving...' : 'Set default'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => updateQuery({ view: 'files', file: null, path: currentPath || null, raw: null })}
            >
              Files
            </Button>
            {getToken() ? null : (
              <Button
                variant="ghost"
                size="sm"
                href={`/login?from=${encodeURIComponent(`/workspaces/${repoWorkspaceRef}/repos/${repoRef}`)}`}
              >
                Login to contribute
              </Button>
            )}
          </InlineFormRow>
        </Card>
      ) : null}

        {isLoading ? (
          <div className="portal-skeleton-grid">
            <PortalCardSkeleton lines={3} />
            <PortalCardSkeleton lines={5} />
          </div>
        ) : authRequired ? (
          <Card className="stack">
            <p className="muted">Sign in is required to open this repository.</p>
            <InlineFormRow align="start">
              <Button
                variant="primary"
                size="sm"
                href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceId}/repos/${repoId}`)}`}
              >
                Sign in
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </InlineFormRow>
          </Card>
        ) : forbidden ? (
          <Card className="stack">
            <p className="muted">You are signed in but do not have access to this repository.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href="/workspaces">
                Workspaces
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </InlineFormRow>
          </Card>
        ) : repo ? (
          isFileMode ? renderFileView() : renderListView()
        ) : (
          <Card>
            <PortalEmptyState message="Repository data could not be loaded." />
          </Card>
        )}

        <Modal
          open={isQuickCreateOpen}
          onClose={() => {
            if (!isQuickCreating) {
              setIsQuickCreateOpen(false);
            }
          }}
          title={quickCreateKind === 'folder' ? 'Create folder scaffold' : 'Create file'}
          subtitle={
            quickCreateKind === 'folder'
              ? `Create a folder scaffold and commit directly to ${activeBranch}.`
              : `Create a file and commit directly to ${activeBranch}.`
          }
          footer={(
            <InlineFormRow align="start">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isQuickCreating}
              onClick={() => {
                setIsQuickCreateOpen(false);
              }}
            >
              Cancel
            </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isQuickCreating}
                onClick={() => {
                  void createNewFile();
                }}
              >
                {isQuickCreating
                  ? 'Creating...'
                  : quickCreateKind === 'folder'
                    ? 'Create folder'
                    : 'Create file'}
              </Button>
            </InlineFormRow>
          )}
        >
          <InlineFormRow align="start">
            <Button
              type="button"
              variant={quickCreateKind === 'file' ? 'primary' : 'secondary'}
              size="sm"
              disabled={isQuickCreating}
              onClick={() => openQuickCreateModal('file')}
            >
              File
            </Button>
            <Button
              type="button"
              variant={quickCreateKind === 'folder' ? 'primary' : 'secondary'}
              size="sm"
              disabled={isQuickCreating}
              onClick={() => openQuickCreateModal('folder')}
            >
              Folder
            </Button>
          </InlineFormRow>
          <label className="field">
            File path
            <input
              autoFocus
              value={quickCreatePath}
              onChange={(event) => setQuickCreatePath(event.target.value)}
              placeholder="src/new-file.ts"
            />
          </label>
          <label className="field">
            Commit message
            <input
              value={quickCreateMessage}
              onChange={(event) => setQuickCreateMessage(event.target.value)}
              placeholder="Add new file"
            />
          </label>
          <label className="field">
            Initial content
            <textarea
              rows={10}
              value={quickCreateContent}
              onChange={(event) => setQuickCreateContent(event.target.value)}
              placeholder="Start typing..."
            />
          </label>
        </Modal>

        <Modal
          open={isBranchModalOpen}
          onClose={() => {
            if (!isCreatingBranch) {
              setIsBranchModalOpen(false);
            }
          }}
          title="Create branch"
          subtitle={`Branch from ${newBranchFrom || activeBranch}.`}
          footer={(
            <InlineFormRow align="start">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isCreatingBranch}
                onClick={() => setIsBranchModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isCreatingBranch}
                onClick={() => {
                  void createBranchFromCurrent();
                }}
              >
                {isCreatingBranch ? 'Creating...' : 'Create branch'}
              </Button>
            </InlineFormRow>
          )}
        >
          <label className="field">
            Branch name
            <input
              autoFocus
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="feature/improve-ui"
            />
          </label>
          <label className="field">
            From branch
            <select
              value={newBranchFrom || activeBranch}
              onChange={(event) => setNewBranchFrom(event.target.value)}
            >
              {(branches.length
                ? branches
                : [{ name: activeBranch, sha: '' } as Branch]
              ).map((branch) => (
                <option key={branch.name} value={sanitizeBranchName(branch.name)}>
                  {sanitizeBranchName(branch.name)}
                </option>
              ))}
            </select>
          </label>
        </Modal>
      </PortalPage>
    </AppShell>
  );
}






