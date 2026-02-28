'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { clearToken, getToken } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { resolveMediaUrl } from '../lib/media';
import { UynisLogo } from './UynisLogo';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type AppMode = 'home' | 'notifications' | 'account';

type NavItem = {
  label: string;
  href: string;
  activeMatch?: (pathname: string) => boolean;
};

type UserIdentity = {
  username?: string | null;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
};

type WorkspaceSidebarContext = {
  id: string;
  slug: string;
  isPersonal?: boolean;
};

type RepoSearchContext = {
  id: string;
  slug: string;
  name?: string;
  workspaceId: string;
};

type HeaderSearchType = 'issue' | 'pull' | 'discussion' | 'code' | 'shortcut';

type HeaderSearchResult = {
  id: string;
  title?: string;
  workspaceId?: string;
  repoId?: string;
  workspaceName?: string;
  repoName?: string;
  status?: string;
  path?: string;
  branch?: string;
  updatedAt?: string;
  createdAt?: string;
};

type HeaderSearchSuggestion = {
  id: string;
  type: HeaderSearchType;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
  queryToken?: string;
};

type HeaderSearchTreeEntry = {
  type: 'tree' | 'blob';
  path: string;
  name: string;
};

type HeaderSearchBlob = {
  path: string;
  branch?: string | null;
  size?: number | null;
  isBinary?: boolean | null;
  content?: string | null;
};

function ChevronIcon({
  direction,
  className,
}: {
  direction: 'right' | 'left';
  className?: string;
}) {
  const rotation = direction === 'left' ? 'rotate(180 25 25)' : undefined;
  return (
    <svg
      className={className}
      viewBox="0 0 50 50"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={rotation}>
        <path
          fill="currentColor"
          d="M15.563 40.836a.997.997 0 0 0 1.414 0l15-15a1 1 0 0 0 0-1.414l-15-15a.999.999 0 1 0-1.414 1.414l14.293 14.293-14.293 14.293a1 1 0 0 0 0 1.414"
        />
      </g>
    </svg>
  );
}

const iconForLabel = (label: string) => {
  const key = label.toLowerCase();
  switch (key) {
    case 'overview':
    case 'home':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 11.5L12 5l8 6.5" />
          <path d="M6.5 10.5V19h11V10.5" />
        </svg>
      );
    case 'repositories':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M5 6.5c0-1 1-1.8 2.2-1.8h9.6c1.2 0 2.2.8 2.2 1.8v11c0 1-1 1.8-2.2 1.8H7.2C6 19.3 5 18.5 5 17.5z" />
          <path d="M8 8.5h8" />
          <path d="M8 12h8" />
        </svg>
      );
    case 'organizations':
    case 'organization':
    case 'workspaces':
    case 'workspace':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 20h16" />
          <path d="M6.5 20V9.5h11V20" />
          <path d="M12 4l7 3.5v2H5v-2z" />
          <path d="M9 12.5v3.5" />
          <path d="M12 12.5v3.5" />
          <path d="M15 12.5v3.5" />
        </svg>
      );
    case 'issues':
    case 'mentions':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'pull requests':
    case 'reviews':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <circle cx="7" cy="7" r="2.2" />
          <circle cx="17" cy="17" r="2.2" />
          <path d="M7 9.5v7.5" />
          <path d="M17 14V7" />
          <path d="M17 7h-5" />
        </svg>
      );
    case 'tasks':
    case 'board':
    case 'backlog':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <rect x="4" y="5" width="7" height="6" rx="1.5" />
          <rect x="13" y="5" width="7" height="6" rx="1.5" />
          <rect x="4" y="13" width="7" height="6" rx="1.5" />
          <rect x="13" y="13" width="7" height="6" rx="1.5" />
        </svg>
      );
    case 'workflows':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 7h12" />
          <path d="M6 12h8" />
          <path d="M6 17h12" />
          <circle cx="17" cy="12" r="2" />
        </svg>
      );
    case 'roadmap':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4.5 7.5h15" />
          <path d="M9 7.5v9" />
          <path d="M15 7.5v5" />
          <circle cx="9" cy="16.5" r="1.5" />
          <circle cx="15" cy="12.5" r="1.5" />
        </svg>
      );
    case 'discussions':
    case 'messages':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M5 6.5h14v9H9l-4 3z" />
        </svg>
      );
    case 'threads':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M5 8h11" />
          <path d="M9 12h10" />
          <path d="M5 16h11" />
        </svg>
      );
    case 'channels':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M9 4L7 20" />
          <path d="M17 4l-2 16" />
          <path d="M4 9h16" />
          <path d="M3 15h16" />
        </svg>
      );
    case 'manage':
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 6h9" />
          <path d="M4 12h16" />
          <path d="M4 18h7" />
          <circle cx="16" cy="6" r="2" />
          <circle cx="14" cy="12" r="2" />
          <circle cx="10" cy="18" r="2" />
        </svg>
      );
    case 'access':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <rect x="3.8" y="10.2" width="16.4" height="9.2" rx="2.2" />
          <path d="M7.2 10.2V7.6a4.8 4.8 0 0 1 9.6 0v2.6" />
          <circle cx="12" cy="14.8" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'share':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <circle cx="6.5" cy="12" r="2.2" />
          <circle cx="17.5" cy="6" r="2.2" />
          <circle cx="17.5" cy="18" r="2.2" />
          <path d="M8.4 11l7-4" />
          <path d="M8.4 13l7 4" />
        </svg>
      );
    case 'admin':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 3l7 4v5c0 4.5-2.8 7.5-7 9-4.2-1.5-7-4.5-7-9V7z" />
          <path d="M9.5 12h5" />
          <path d="M12 9.5v5" />
        </svg>
      );
    case 'calls':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 8.5h10a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" />
          <path d="M18 11l3-2v7l-3-2" />
        </svg>
      );
    case 'profile':
    case 'account':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19c1.3-3 4-4.5 7-4.5s5.7 1.5 7 4.5" />
        </svg>
      );
    case 'security':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M12 4l7 3v5c0 4.4-3 7.2-7 8-4-0.8-7-3.6-7-8V7z" />
          <path d="M12 9v5" />
        </svg>
      );
    case 'developer':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M8 7L4.5 10.5 8 14" />
          <path d="M16 7l3.5 3.5L16 14" />
          <path d="M10.5 17l3-10" />
        </svg>
      );
    case 'activity':
    case 'system':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 12h4l2-5 4 10 2-5h4" />
        </svg>
      );
    case 'inbox':
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <path d="M4 7h16v10H4z" />
          <path d="M4 12h5l2 3h2l2-3h5" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
};

const detectMode = (pathname: string): AppMode => {
  if (pathname.startsWith('/notifications')) {
    return 'notifications';
  }
  if (pathname.startsWith('/settings')) {
    return 'account';
  }
  return 'home';
};

const initialsFromName = (value: string) => {
  const compact = value.trim();
  if (!compact) {
    return 'U';
  }
  const parts = compact.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'U';
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (target.isContentEditable) {
    return true;
  }
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const normalizeRef = (value?: string | null) => (value ?? '').trim().toLowerCase();
const toSearchToken = (value?: string | null) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const looksLikeOpaqueId = (value: string) => /^[a-z0-9]{18,}$/i.test(value);

const toReadableScopeToken = (value?: string | null) => {
  const token = toSearchToken(value);
  if (!token || looksLikeOpaqueId(token)) {
    return '';
  }
  return token;
};

const formatSearchDate = (value?: string) => {
  if (!value) {
    return 'recent';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'recent';
  }
  return parsed.toLocaleDateString();
};

type SearchBucketType = 'issues' | 'pulls' | 'discussions' | 'code';

const ALL_SEARCH_BUCKETS: SearchBucketType[] = ['issues', 'pulls', 'discussions', 'code'];

const resolveSearchBucket = (value: string): SearchBucketType | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'issues' || normalized === 'issue') {
    return 'issues';
  }
  if (normalized === 'pulls' || normalized === 'pull' || normalized === 'pr' || normalized === 'prs') {
    return 'pulls';
  }
  if (normalized === 'discussions' || normalized === 'discussion') {
    return 'discussions';
  }
  if (normalized === 'code') {
    return 'code';
  }
  return null;
};

const parseHeaderSearchQuery = (rawQuery: string) => {
  const tokens = rawQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const bucketSet = new Set<SearchBucketType>();
  const terms: string[] = [];
  let scopedWorkspace = '';
  let scopedRepo = '';
  let hasTypeQualifier = false;
  let hasScopeQualifier = false;

  for (const token of tokens) {
    const [rawKey, ...rawValueParts] = token.split(':');
    const key = rawKey.toLowerCase();
    const rawValue = rawValueParts.join(':');

    if (key === 'type' && rawValue) {
      const bucket = resolveSearchBucket(rawValue);
      if (bucket) {
        hasTypeQualifier = true;
        bucketSet.add(bucket);
        continue;
      }
    }

    if (key === 'workspace' || key === 'ws') {
      hasScopeQualifier = true;
      if (rawValue) {
        scopedWorkspace = normalizeRef(rawValue);
      }
      continue;
    }

    if (key === 'repo') {
      hasScopeQualifier = true;
      if (rawValue) {
        const normalizedRepo = normalizeRef(rawValue);
        const slashIndex = normalizedRepo.indexOf('/');
        if (slashIndex > 0 && slashIndex < normalizedRepo.length - 1) {
          const workspaceToken = normalizedRepo.slice(0, slashIndex);
          const repoToken = normalizedRepo.slice(slashIndex + 1);
          if (workspaceToken && !scopedWorkspace) {
            scopedWorkspace = workspaceToken;
          }
          scopedRepo = repoToken;
        } else {
          scopedRepo = normalizedRepo;
        }
      }
      continue;
    }

    const prefixedBucket = resolveSearchBucket(key);
    if (prefixedBucket) {
      hasTypeQualifier = true;
      bucketSet.add(prefixedBucket);
      if (rawValue) {
        terms.push(rawValue);
      }
      continue;
    }

    terms.push(token);
  }

  const bucketTypes = bucketSet.size ? Array.from(bucketSet) : ALL_SEARCH_BUCKETS;
  return {
    searchTerm: terms.join(' ').trim(),
    bucketTypes,
    scopedWorkspace,
    scopedRepo,
    hasTypeQualifier,
    hasScopeQualifier,
  };
};

const mergeShortcutTokens = (existingQuery: string, shortcutToken: string) => {
  const baseTokens = existingQuery
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const incomingTokens = shortcutToken
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!incomingTokens.length) {
    return existingQuery.trim();
  }

  const nextTokens = [...baseTokens];
  const scopedKeys = new Set(['type', 'repo', 'workspace', 'ws']);

  for (const incomingToken of incomingTokens) {
    const [rawKey] = incomingToken.split(':');
    const key = rawKey?.toLowerCase() ?? '';
    if (scopedKeys.has(key)) {
      for (let index = nextTokens.length - 1; index >= 0; index -= 1) {
        const [candidateKey] = nextTokens[index].split(':');
        if ((candidateKey ?? '').toLowerCase() === key) {
          nextTokens.splice(index, 1);
        }
      }
    }

    if (!nextTokens.some((token) => token.toLowerCase() === incomingToken.toLowerCase())) {
      nextTokens.push(incomingToken);
    }
  }

  return nextTokens.join(' ').trim();
};

const buildSuggestionHref = (
  type: Exclude<HeaderSearchType, 'shortcut'>,
  result: HeaderSearchResult,
) => {
  if (type === 'issue' && result.workspaceId && result.repoId) {
    return `/workspaces/${result.workspaceId}/repos/${result.repoId}/issues/${result.id}`;
  }
  if (type === 'pull' && result.workspaceId && result.repoId) {
    return `/workspaces/${result.workspaceId}/repos/${result.repoId}/pulls/${result.id}`;
  }
  if (type === 'discussion') {
    return `/discussions?view=threads&item=${encodeURIComponent(result.id)}`;
  }
  if (type === 'code' && result.workspaceId && result.repoId && result.path) {
    const params = new URLSearchParams({ file: result.path, view: 'files' });
    if (result.branch) {
      params.set('branch', result.branch);
    }
    return `/workspaces/${result.workspaceId}/repos/${result.repoId}?${params.toString()}`;
  }
  return '';
};

let appShellHydratedOnce = false;
let appShellSidebarCollapsedPref: boolean | null = null;
const SIDEBAR_COLLAPSED_KEY = 'uynis.portal.sidebar_collapsed';

export function AppShell({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const [isHydrated, setIsHydrated] = useState<boolean>(appShellHydratedOnce);
  const [hasToken, setHasToken] = useState<boolean>(() =>
    appShellHydratedOnce ? Boolean(getToken()) : false,
  );
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => appShellSidebarCollapsedPref ?? false,
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [workspaceSidebarContext, setWorkspaceSidebarContext] =
    useState<WorkspaceSidebarContext | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [localSearch, setLocalSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<HeaderSearchSuggestion[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const desktopSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceContextCacheRef = useRef<Map<string, WorkspaceSidebarContext | null>>(new Map());
  const repoSearchContextCacheRef = useRef<Map<string, RepoSearchContext | null>>(new Map());
  const repoScopeLookupCacheRef = useRef<Map<string, { repoId: string; workspaceId: string }>>(
    new Map(),
  );
  const searchSuggestionCacheRef = useRef<Map<string, HeaderSearchSuggestion[]>>(new Map());
  const prefetchedRoutesRef = useRef<Set<string>>(new Set());
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shellVariant = hasToken ? 'portal-shell--authed' : 'portal-shell--guest';
  const isRepoFileView =
    pathname.includes('/workspaces/') &&
    pathname.includes('/repos/') &&
    (Boolean(searchParams.get('file')) ||
      Boolean(searchParams.get('path')) ||
      searchParams.get('view') === 'files');
  const isTasksBoardView = pathname.startsWith('/tasks') && searchParams.get('view') === 'board';

  const focusHeaderSearch = useCallback(() => {
    const visibleInput =
      [desktopSearchInputRef.current, mobileSearchInputRef.current].find(
        (input) => input && input.offsetParent !== null,
      ) ?? desktopSearchInputRef.current ?? mobileSearchInputRef.current;
    if (visibleInput) {
      visibleInput.focus();
      setSearchOpen(true);
      const length = visibleInput.value.length;
      visibleInput.setSelectionRange(length, length);
    }
  }, []);

  const setSidebarCollapsedPersisted = useCallback((next: boolean) => {
    setSidebarCollapsed(next);
    appShellSidebarCollapsedPref = next;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Ignore persistence failures (private mode / blocked storage).
      }
    }
  }, []);

  useEffect(() => {
    appShellHydratedOnce = true;
    setHasToken(Boolean(getToken()));
    if (typeof window !== 'undefined') {
      try {
        const storedSidebar = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
        if (storedSidebar === '1' || storedSidebar === 'true') {
          appShellSidebarCollapsedPref = true;
          setSidebarCollapsed(true);
        } else if (storedSidebar === '0' || storedSidebar === 'false') {
          appShellSidebarCollapsedPref = false;
          setSidebarCollapsed(false);
        }
      } catch {
        // Ignore storage read errors and fall back to in-memory defaults.
      }
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const applyTheme = () => {
      const rootTheme = root.getAttribute('data-theme');
      setTheme(rootTheme === 'light' ? 'light' : 'dark');
    };

    applyTheme();
    const observer = new MutationObserver(applyTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasToken) {
      return;
    }
    const interval = window.setInterval(() => {
      const token = getToken();
      if (!token) {
        setHasToken(false);
        window.location.replace('/login');
      }
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [hasToken]);

  useEffect(() => {
    const nextHasToken = Boolean(getToken());
    setHasToken(nextHasToken);
    if (!nextHasToken) {
      setUser(null);
    }
    setSidebarOpen(false);
    setSearchOpen(false);
    setLocalSearch('');
  }, [pathname]);

  useEffect(() => {
    if (!hasToken) {
      setUser(null);
      return;
    }
    const loadUser = async () => {
      try {
        const data = await apiFetch<{ user: UserIdentity }>('/me', {
          suppressAuthRedirect: true,
          cacheTtlMs: false,
        });
        setUser(data.user);
      } catch (error) {
        if ((error as { status?: number } | null)?.status === 401) {
          setIsSigningOut(true);
          clearToken();
          setHasToken(false);
          if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
            window.location.replace('/login');
          }
          return;
        }
        setUser(null);
      }
    };
    void loadUser();
  }, [hasToken, pathname]);

  useEffect(() => {
    if (!hasToken) {
      setNotificationUnreadCount(0);
      return;
    }

    let cancelled = false;
    const loadUnreadSummary = async () => {
      try {
        const data = await apiFetch<{ unread: { inbox: number } }>(
          '/me/notifications?tab=inbox&limit=1',
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 12_000,
          },
        );
        if (!cancelled) {
          setNotificationUnreadCount(Math.max(0, data.unread?.inbox ?? 0));
        }
      } catch {
        if (!cancelled) {
          setNotificationUnreadCount(0);
        }
      }
    };

    void loadUnreadSummary();
    const interval = window.setInterval(() => {
      void loadUnreadSummary();
    }, 45_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hasToken]);

  useEffect(() => {
    if (!hasToken) {
      return;
    }

    const handleKeyboardSearch = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const wantsShortcutSearch =
        (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) ||
        (event.key === '/' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey);

      if (!wantsShortcutSearch) {
        return;
      }

      event.preventDefault();
      focusHeaderSearch();
    };

    window.addEventListener('keydown', handleKeyboardSearch);
    return () => {
      window.removeEventListener('keydown', handleKeyboardSearch);
    };
  }, [focusHeaderSearch, hasToken]);

  const mode = detectMode(pathname);
  const isInboxSearch =
    pathname.startsWith('/issues') ||
    pathname.startsWith('/pulls') ||
    pathname.startsWith('/tasks') ||
    pathname.startsWith('/discussions');
  const isUrlSearchControlled = isInboxSearch;
  const headerSearchValue = isUrlSearchControlled
    ? (searchParams.get('q') ?? '')
    : localSearch;
  const activeSearchValue = headerSearchValue;
  const [repoSearchContext, setRepoSearchContext] = useState<RepoSearchContext | null>(null);
  const [workspaceFromPath, repoFromPath] = (() => {
    const workspaceMatch = pathname.match(/^\/workspaces\/([^/]+)/);
    const repoMatch = pathname.match(/^\/workspaces\/[^/]+\/repos\/([^/?#]+)/);
    return [workspaceMatch?.[1] ?? null, repoMatch?.[1] ?? null] as const;
  })();

  useEffect(() => {
    if (!hasToken || !workspaceFromPath) {
      setWorkspaceSidebarContext(null);
      return;
    }

    const cachedWorkspaceContext = workspaceContextCacheRef.current.get(workspaceFromPath);
    if (cachedWorkspaceContext !== undefined) {
      setWorkspaceSidebarContext(cachedWorkspaceContext);
      return;
    }

    let cancelled = false;
    const loadWorkspaceContext = async () => {
      try {
        const data = await apiFetch<{ workspace?: WorkspaceSidebarContext }>(
          `/workspaces/${workspaceFromPath}`,
          {
            suppressAuthRedirect: true,
            cacheTtlMs: 60_000,
          },
        );
        if (!cancelled) {
          const nextWorkspaceContext = data.workspace ?? null;
          workspaceContextCacheRef.current.set(workspaceFromPath, nextWorkspaceContext);
          setWorkspaceSidebarContext(nextWorkspaceContext);
        }
      } catch {
        if (!cancelled) {
          workspaceContextCacheRef.current.set(workspaceFromPath, null);
          setWorkspaceSidebarContext(null);
        }
      }
    };

    void loadWorkspaceContext();
    return () => {
      cancelled = true;
    };
  }, [hasToken, workspaceFromPath]);

  useEffect(() => {
    if (!hasToken || !workspaceFromPath || !repoFromPath) {
      setRepoSearchContext(null);
      return;
    }

    const contextKey = `${workspaceFromPath}/${repoFromPath}`;
    const cachedRepoContext = repoSearchContextCacheRef.current.get(contextKey);
    if (cachedRepoContext !== undefined) {
      setRepoSearchContext(cachedRepoContext);
      return;
    }

    let cancelled = false;
    const loadRepoSearchContext = async () => {
      try {
        const data = await apiFetch<{
          repo?: { id: string; slug: string; name?: string | null; workspaceId: string };
        }>(`/workspaces/${workspaceFromPath}/repos/${repoFromPath}`, {
          suppressAuthRedirect: true,
          cacheTtlMs: 60_000,
        });
        if (!cancelled) {
        const nextContext = data.repo
            ? {
                id: data.repo.id,
                slug: data.repo.slug,
                name: data.repo.name ?? data.repo.slug,
                workspaceId: data.repo.workspaceId,
              }
            : null;
          repoSearchContextCacheRef.current.set(contextKey, nextContext);
          setRepoSearchContext(nextContext);
        }
      } catch {
        if (!cancelled) {
          repoSearchContextCacheRef.current.set(contextKey, null);
          setRepoSearchContext(null);
        }
      }
    };

    void loadRepoSearchContext();
    return () => {
      cancelled = true;
    };
  }, [hasToken, repoFromPath, workspaceFromPath]);
  const headerSearchPlaceholder =
    pathname.startsWith('/workspaces/') && pathname.includes('/repos/')
      ? 'Search in this repository'
      : pathname.startsWith('/workspaces/')
        ? 'Search in this workspace'
        : pathname.startsWith('/issues')
          ? 'Search issues'
          : pathname.startsWith('/pulls')
            ? 'Search pull requests'
            : pathname.startsWith('/tasks')
              ? 'Search tasks, labels, assignees'
            : pathname.startsWith('/discussions')
              ? 'Search discussions'
              : 'Search repositories, issues, pull requests, discussions';
  const userLabel = user?.username || user?.name || user?.email || 'Account';
  const avatarSrc = resolveMediaUrl(user?.avatarUrl);
  const avatarNode = avatarSrc ? (
    <Image
      className="portal-avatar"
      src={avatarSrc}
      alt={userLabel}
      width={30}
      height={30}
      unoptimized
    />
  ) : (
    <span className="portal-avatar portal-avatar-initials" aria-hidden="true">
      {initialsFromName(userLabel)}
    </span>
  );
  const trimmedSearchQuery = activeSearchValue.trim();
  const parsedSearchQuery = useMemo(
    () => parseHeaderSearchQuery(trimmedSearchQuery),
    [trimmedSearchQuery],
  );
  const shouldUseContextualSearchScope = useMemo(
    () => !parsedSearchQuery.hasTypeQualifier && !parsedSearchQuery.hasScopeQualifier,
    [parsedSearchQuery.hasScopeQualifier, parsedSearchQuery.hasTypeQualifier],
  );
  const scopedWorkspaceForSearch = useMemo(() => {
    const scopedToken = normalizeRef(parsedSearchQuery.scopedWorkspace);
    if (scopedToken) {
      if (
        workspaceFromPath &&
        normalizeRef(workspaceFromPath) === scopedToken &&
        workspaceSidebarContext?.id
      ) {
        return workspaceSidebarContext.id;
      }
      return scopedToken;
    }
    return shouldUseContextualSearchScope ? workspaceSidebarContext?.id ?? '' : '';
  }, [
    parsedSearchQuery.scopedWorkspace,
    shouldUseContextualSearchScope,
    workspaceFromPath,
    workspaceSidebarContext?.id,
  ]);
  const scopedRepoForSearch = useMemo(() => {
    const scopedToken = normalizeRef(parsedSearchQuery.scopedRepo);
    if (scopedToken) {
      if (repoFromPath && normalizeRef(repoFromPath) === scopedToken && repoSearchContext?.id) {
        return repoSearchContext.id;
      }
      return scopedToken;
    }
    return shouldUseContextualSearchScope ? repoSearchContext?.id ?? '' : '';
  }, [
    parsedSearchQuery.scopedRepo,
    repoFromPath,
    repoSearchContext?.id,
    shouldUseContextualSearchScope,
  ]);

  const quickSearchSuggestions = useMemo<HeaderSearchSuggestion[]>(() => {
    if (repoFromPath && workspaceFromPath) {
      const routeRepoToken = toSearchToken(repoFromPath);
      const repoScopeToken =
        toReadableScopeToken(repoSearchContext?.name) ||
        toReadableScopeToken(repoSearchContext?.slug) ||
        (!looksLikeOpaqueId(routeRepoToken) ? routeRepoToken : '');
      const repoScopeSubtitle =
        repoSearchContext?.name ??
        repoSearchContext?.slug ??
        repoFromPath;
      if (repoScopeToken) {
        return [
          {
            id: `shortcut-repo-code-${repoFromPath}`,
            type: 'shortcut',
            title: 'Code in this repo',
            subtitle: `Adds: type:code repo:${repoScopeSubtitle}`,
            href: pathname,
            queryToken: `type:code repo:${repoScopeToken}`,
          },
          {
            id: `shortcut-repo-issues-${repoFromPath}`,
            type: 'shortcut',
            title: 'Issues in this repo',
            subtitle: `Adds: type:issues repo:${repoScopeSubtitle}`,
            href: pathname,
            queryToken: `type:issues repo:${repoScopeToken}`,
          },
          {
            id: `shortcut-repo-pulls-${repoFromPath}`,
            type: 'shortcut',
            title: 'Pulls in this repo',
            subtitle: `Adds: type:pulls repo:${repoScopeSubtitle}`,
            href: pathname,
            queryToken: `type:pulls repo:${repoScopeToken}`,
          },
          {
            id: `shortcut-repo-discussions-${repoFromPath}`,
            type: 'shortcut',
            title: 'Discussions in this repo',
            subtitle: `Adds: type:discussions repo:${repoScopeSubtitle}`,
            href: pathname,
            queryToken: `type:discussions repo:${repoScopeToken}`,
          },
        ];
      }
    }
    if (workspaceFromPath) {
      const workspaceScopeToken =
        toSearchToken(workspaceSidebarContext?.slug) ||
        toSearchToken(workspaceFromPath) ||
        workspaceFromPath;
      return [
        {
          id: `shortcut-workspace-issues-${workspaceFromPath}`,
          type: 'shortcut',
          title: 'Issues in this workspace',
          subtitle: `Adds: type:issues workspace:${workspaceFromPath}`,
          href: pathname,
          queryToken: `type:issues workspace:${workspaceScopeToken}`,
        },
        {
          id: `shortcut-workspace-pulls-${workspaceFromPath}`,
          type: 'shortcut',
          title: 'Pulls in this workspace',
          subtitle: `Adds: type:pulls workspace:${workspaceFromPath}`,
          href: pathname,
          queryToken: `type:pulls workspace:${workspaceScopeToken}`,
        },
        {
          id: `shortcut-workspace-code-${workspaceFromPath}`,
          type: 'shortcut',
          title: 'Code in this workspace',
          subtitle: `Adds: type:code workspace:${workspaceFromPath}`,
          href: pathname,
          queryToken: `type:code workspace:${workspaceScopeToken}`,
        },
      ];
    }
    return [
      {
        id: 'shortcut-global-issues',
        type: 'shortcut',
        title: 'Global issues',
        subtitle: 'Adds: type:issues',
        href: pathname,
        queryToken: 'type:issues',
      },
      {
        id: 'shortcut-global-pulls',
        type: 'shortcut',
        title: 'Global pull requests',
        subtitle: 'Adds: type:pulls',
        href: pathname,
        queryToken: 'type:pulls',
      },
      {
        id: 'shortcut-global-discussions',
        type: 'shortcut',
        title: 'Global discussions',
        subtitle: 'Adds: type:discussions',
        href: pathname,
        queryToken: 'type:discussions',
      },
      {
        id: 'shortcut-global-code',
        type: 'shortcut',
        title: 'Global code',
        subtitle: 'Adds: type:code',
        href: pathname,
        queryToken: 'type:code',
      },
    ];
  }, [
    pathname,
    repoFromPath,
    repoSearchContext?.name,
    repoSearchContext?.slug,
    workspaceFromPath,
    workspaceSidebarContext?.slug,
  ]);

  const shouldUseQuerySuggestions = parsedSearchQuery.searchTerm.length >= 1;
  const visibleSearchSuggestions = useMemo(
    () => (shouldUseQuerySuggestions ? searchSuggestions : quickSearchSuggestions),
    [quickSearchSuggestions, searchSuggestions, shouldUseQuerySuggestions],
  );
  const shouldShowCodeScopeHint =
    shouldUseQuerySuggestions &&
    parsedSearchQuery.bucketTypes.length === 1 &&
    parsedSearchQuery.bucketTypes[0] === 'code' &&
    !scopedRepoForSearch;

  const showSearchSuggestions =
    hasToken &&
    searchOpen &&
    (searchLoading || visibleSearchSuggestions.length > 0 || shouldUseQuerySuggestions);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      if (
        target.closest('.portal-header-searchbar') ||
        target.closest('.portal-header-search-suggestions')
      ) {
        return;
      }
      setSearchOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!hasToken) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      return;
    }
    if (!searchOpen || parsedSearchQuery.searchTerm.length < 1) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const searchCacheKey = [
          normalizeRef(workspaceFromPath),
          normalizeRef(repoFromPath),
          parsedSearchQuery.searchTerm,
          parsedSearchQuery.bucketTypes.join(','),
          scopedWorkspaceForSearch,
          scopedRepoForSearch,
        ].join('|');
        const cachedSuggestions = searchSuggestionCacheRef.current.get(searchCacheKey);
        if (cachedSuggestions) {
          if (!cancelled) {
            setSearchSuggestions(cachedSuggestions);
            setSearchLoading(false);
          }
          return;
        }

        const resolveWorkspaceScope = async () => {
          if (!scopedWorkspaceForSearch) {
            return '';
          }
          if (workspaceSidebarContext?.id && normalizeRef(workspaceSidebarContext.id) === normalizeRef(scopedWorkspaceForSearch)) {
            return workspaceSidebarContext.id;
          }
          if (
            workspaceFromPath &&
            normalizeRef(workspaceFromPath) === normalizeRef(scopedWorkspaceForSearch) &&
            workspaceSidebarContext?.id
          ) {
            return workspaceSidebarContext.id;
          }
          try {
            const resolvedWorkspace = await apiFetch<{ workspace?: { id: string } }>(
              `/workspaces/${scopedWorkspaceForSearch}`,
              {
                suppressAuthRedirect: true,
                cacheTtlMs: 60_000,
              },
            );
            return resolvedWorkspace.workspace?.id ?? '';
          } catch {
            return '';
          }
        };

        const resolveRepoScope = async (workspaceScope: string) => {
          if (!scopedRepoForSearch) {
            return '';
          }
          const repoScopeTokenNormalized = normalizeRef(scopedRepoForSearch);
          const cachedRepoScope = repoScopeLookupCacheRef.current.get(repoScopeTokenNormalized);
          if (cachedRepoScope?.repoId) {
            return cachedRepoScope.repoId;
          }
          if (repoSearchContext?.id && normalizeRef(repoSearchContext.id) === normalizeRef(scopedRepoForSearch)) {
            return repoSearchContext.id;
          }
          if (
            repoFromPath &&
            normalizeRef(repoFromPath) === normalizeRef(scopedRepoForSearch) &&
            repoSearchContext?.id
          ) {
            return repoSearchContext.id;
          }
          const resolveRepoFromWorkspaceList = async (workspaceRef: string, token: string) => {
            try {
              const repoListData = await apiFetch<{
                repos: Array<{ id: string; slug?: string | null; name?: string | null }>;
              }>(`/workspaces/${workspaceRef}/repos`, {
                suppressAuthRedirect: true,
                cacheTtlMs: 60_000,
              });
              const normalizedToken = normalizeRef(token);
              const match = repoListData.repos.find((repo) => {
                const slug = normalizeRef(repo.slug);
                const name = normalizeRef(toSearchToken(repo.name));
                const id = normalizeRef(repo.id);
                return slug === normalizedToken || name === normalizedToken || id === normalizedToken;
              });
              if (match?.id) {
                repoScopeLookupCacheRef.current.set(normalizedToken, {
                  repoId: match.id,
                  workspaceId: workspaceRef,
                });
              }
              return match?.id ?? '';
            } catch {
              return '';
            }
          };

          const resolveRepoFromAllWorkspaces = async (token: string) => {
            const normalizedToken = normalizeRef(token);
            if (!normalizedToken) {
              return '';
            }
            const cached = repoScopeLookupCacheRef.current.get(normalizedToken);
            if (cached?.repoId) {
              return cached.repoId;
            }
            try {
              const workspaceData = await apiFetch<{
                workspaces?: Array<{ id: string; slug?: string | null }>;
              }>('/workspaces', {
                suppressAuthRedirect: true,
                cacheTtlMs: 60_000,
              });
              const workspaceList = workspaceData.workspaces ?? [];
              if (!workspaceList.length) {
                return '';
              }
              const resolved = await Promise.all(
                workspaceList.map(async (workspace) => {
                  const repoId = await resolveRepoFromWorkspaceList(workspace.id, token);
                  if (!repoId) {
                    return null;
                  }
                  return { repoId, workspaceId: workspace.id };
                }),
              );
              const firstMatch = resolved.find((entry) => Boolean(entry));
              if (!firstMatch) {
                return '';
              }
              repoScopeLookupCacheRef.current.set(normalizedToken, firstMatch);
              return firstMatch.repoId;
            } catch {
              return '';
            }
          };

          const workspaceRef =
            workspaceScope ||
            normalizeRef(parsedSearchQuery.scopedWorkspace) ||
            normalizeRef(workspaceFromPath);
          if (!workspaceRef) {
            return resolveRepoFromAllWorkspaces(scopedRepoForSearch);
          }

          try {
            const resolvedRepo = await apiFetch<{ repo?: { id: string } }>(
              `/workspaces/${workspaceRef}/repos/${scopedRepoForSearch}`,
              {
                suppressAuthRedirect: true,
                cacheTtlMs: 60_000,
              },
            );
            if (resolvedRepo.repo?.id) {
              repoScopeLookupCacheRef.current.set(repoScopeTokenNormalized, {
                repoId: resolvedRepo.repo.id,
                workspaceId: workspaceRef,
              });
              return resolvedRepo.repo.id;
            }
            const workspaceScoped = await resolveRepoFromWorkspaceList(workspaceRef, scopedRepoForSearch);
            if (workspaceScoped) {
              return workspaceScoped;
            }
            return resolveRepoFromAllWorkspaces(scopedRepoForSearch);
          } catch {
            const workspaceScoped = await resolveRepoFromWorkspaceList(workspaceRef, scopedRepoForSearch);
            if (workspaceScoped) {
              return workspaceScoped;
            }
            return resolveRepoFromAllWorkspaces(scopedRepoForSearch);
          }
        };

        const resolvedWorkspaceScope =
          scopedWorkspaceForSearch ? await resolveWorkspaceScope() : '';
        const resolvedRepoScope =
          scopedRepoForSearch ? await resolveRepoScope(resolvedWorkspaceScope) : '';

        const scopedWorkspace =
          parsedSearchQuery.scopedWorkspace
            ? resolvedWorkspaceScope
            : resolvedWorkspaceScope || scopedWorkspaceForSearch;
        const scopedRepo =
          parsedSearchQuery.scopedRepo
            ? resolvedRepoScope
            : resolvedRepoScope || scopedRepoForSearch;

        const fetchBucket = async (type: 'issues' | 'pulls' | 'discussions') => {
          const params = new URLSearchParams({
            q: parsedSearchQuery.searchTerm,
            type,
          });
          if (scopedWorkspace) {
            params.set('workspaceId', scopedWorkspace);
          }
          if (scopedRepo) {
            params.set('repoId', scopedRepo);
          }
          return apiFetch<{ results: HeaderSearchResult[] }>(
            `/search?${params.toString()}`,
            { suppressAuthRedirect: true },
          );
        };

        const activeBucketSet = new Set(parsedSearchQuery.bucketTypes);
        const fetchBucketOrEmpty = async (type: 'issues' | 'pulls' | 'discussions') => {
          if (!activeBucketSet.has(type)) {
            return { results: [] as HeaderSearchResult[] };
          }
          return fetchBucket(type);
        };

        const runCodeFallbackSearch = async (input: {
          workspaceRef: string;
          repoRef: string;
          branchHint?: string;
          repoNameHint?: string;
          workspaceNameHint?: string;
        }) => {
          const needle = parsedSearchQuery.searchTerm.trim().toLowerCase();
          if (!needle || needle.length < 2) {
            return [] as HeaderSearchResult[];
          }

          const maxTreeRequests = 70;
          const maxBlobReads = 160;
          const maxBlobSize = 180_000;
          const maxResults = 12;
          const pendingPaths: string[] = [''];
          const visitedPaths = new Set<string>();
          const results: HeaderSearchResult[] = [];

          let treeRequests = 0;
          let blobReads = 0;

          while (
            pendingPaths.length &&
            treeRequests < maxTreeRequests &&
            blobReads < maxBlobReads &&
            results.length < maxResults
          ) {
            const currentPath = pendingPaths.shift();
            if (currentPath === undefined || visitedPaths.has(currentPath)) {
              continue;
            }
            visitedPaths.add(currentPath);
            treeRequests += 1;

            const treeParams = new URLSearchParams();
            if (input.branchHint) {
              treeParams.set('branch', input.branchHint);
            }
            if (currentPath) {
              treeParams.set('path', currentPath);
            }

            let treeEntries: HeaderSearchTreeEntry[] = [];
            try {
              const treeResponse = await apiFetch<{
                entries?: HeaderSearchTreeEntry[];
                tree?: { entries?: HeaderSearchTreeEntry[] };
              }>(
                `/workspaces/${input.workspaceRef}/repos/${input.repoRef}/tree?${treeParams.toString()}`,
                {
                  suppressAuthRedirect: true,
                  cacheTtlMs: 10_000,
                },
              );
              treeEntries = treeResponse.entries ?? treeResponse.tree?.entries ?? [];
            } catch {
              continue;
            }

            for (const entry of treeEntries) {
              if (entry.type === 'tree') {
                pendingPaths.push(entry.path);
                continue;
              }
              if (entry.type !== 'blob') {
                continue;
              }
              if (blobReads >= maxBlobReads || results.length >= maxResults) {
                break;
              }
              blobReads += 1;

              const blobParams = new URLSearchParams();
              if (input.branchHint) {
                blobParams.set('branch', input.branchHint);
              }
              blobParams.set('path', entry.path);

              let blob: HeaderSearchBlob | null = null;
              try {
                const blobResponse = await apiFetch<{ blob?: HeaderSearchBlob | null }>(
                  `/workspaces/${input.workspaceRef}/repos/${input.repoRef}/blob?${blobParams.toString()}`,
                  {
                    suppressAuthRedirect: true,
                    cacheTtlMs: 10_000,
                  },
                );
                blob = blobResponse.blob ?? null;
              } catch {
                continue;
              }

              if (!blob || blob.isBinary) {
                continue;
              }
              if (typeof blob.size === 'number' && blob.size > maxBlobSize) {
                continue;
              }
              const content = blob.content ?? '';
              if (!content || !content.toLowerCase().includes(needle)) {
                continue;
              }

              results.push({
                id: `fallback:${input.repoRef}:${entry.path}:${results.length}`,
                title: entry.name || entry.path.split('/').pop() || entry.path,
                workspaceId: input.workspaceRef,
                repoId: input.repoRef,
                workspaceName: input.workspaceNameHint || input.workspaceRef,
                repoName: input.repoNameHint || input.repoRef,
                path: entry.path,
                branch: input.branchHint || blob.branch || undefined,
              });
            }
          }

          return results;
        };

        const fetchCodeOrEmpty = async () => {
          if (!activeBucketSet.has('code')) {
            return { results: [] as HeaderSearchResult[] };
          }
          const runCodeSearch = async (repoId: string) => {
            const params = new URLSearchParams({
              q: parsedSearchQuery.searchTerm,
              repoId,
            });
            return apiFetch<{ results: HeaderSearchResult[] }>(
              `/search/code?${params.toString()}`,
              { suppressAuthRedirect: true },
            );
          };

          const resolveRepoScopeFromPath = async () => {
            if (!workspaceFromPath || !repoFromPath) {
              return '';
            }
            try {
              const resolvedRepo = await apiFetch<{ repo?: { id: string } }>(
                `/workspaces/${workspaceFromPath}/repos/${repoFromPath}`,
                {
                  suppressAuthRedirect: true,
                  cacheTtlMs: 60_000,
                },
              );
              return resolvedRepo.repo?.id ?? '';
            } catch {
              return '';
            }
          };

          let repoScopeForCode = scopedRepo || repoSearchContext?.id || '';
          if (!repoScopeForCode) {
            repoScopeForCode = await resolveRepoScopeFromPath();
          }
          if (!repoScopeForCode) {
            return { results: [] as HeaderSearchResult[] };
          }
          let indexedResult: { source?: string; results: HeaderSearchResult[] } = {
            results: [],
          };
          try {
            indexedResult = await runCodeSearch(repoScopeForCode);
          } catch {
            indexedResult = { results: [] };
          }
          if (indexedResult.results.length > 0) {
            return indexedResult;
          }

          const repoToken = normalizeRef(parsedSearchQuery.scopedRepo);
          const cachedRepoScope = repoToken
            ? repoScopeLookupCacheRef.current.get(repoToken)
            : null;
          const workspaceScopeForFallback =
            scopedWorkspace ||
            cachedRepoScope?.workspaceId ||
            repoSearchContext?.workspaceId ||
            normalizeRef(workspaceFromPath) ||
            '';
          if (!workspaceScopeForFallback) {
            return indexedResult;
          }

          const branchHint = normalizeRef(searchParams.get('branch')) || undefined;
          const fallbackResults = await runCodeFallbackSearch({
            workspaceRef: workspaceScopeForFallback,
            repoRef: repoScopeForCode,
            branchHint,
            repoNameHint: repoSearchContext?.name || repoFromPath || undefined,
            workspaceNameHint: workspaceSidebarContext?.slug || workspaceFromPath || undefined,
          });
          if (!fallbackResults.length) {
            return indexedResult;
          }
          return {
            source: indexedResult.source ?? 'tree-fallback',
            results: fallbackResults,
          };
        };

        const [issuesResult, pullsResult, discussionsResult, codeResult] = await Promise.allSettled([
          fetchBucketOrEmpty('issues'),
          fetchBucketOrEmpty('pulls'),
          fetchBucketOrEmpty('discussions'),
          fetchCodeOrEmpty(),
        ]);

        if (cancelled) {
          return;
        }

        const mapSuggestions = (
          type: Exclude<HeaderSearchType, 'shortcut'>,
          rawResults: HeaderSearchResult[],
        ) =>
          rawResults
            .slice(0, 4)
            .map((result, index) => {
              const href = buildSuggestionHref(type, result);
              if (!href) {
                return null;
              }
              const title =
                result.title?.trim() ||
                (type === 'code' ? result.path || result.id : result.id);
              const subtitleParts = [
                result.workspaceName || result.workspaceId
                  ? `Workspace: ${result.workspaceName || result.workspaceId}`
                  : null,
                result.repoName || result.repoId
                  ? `Repo: ${result.repoName || result.repoId}`
                  : null,
                type === 'code' && result.path ? `Path: ${result.path}` : null,
                `Updated ${formatSearchDate(result.updatedAt || result.createdAt)}`,
              ].filter(Boolean);

              return {
                id: `${type}-${result.id}-${index}`,
                type,
                title,
                subtitle: subtitleParts.join(' | '),
                href,
                status: result.status,
              } as HeaderSearchSuggestion;
            })
            .filter((entry): entry is HeaderSearchSuggestion => Boolean(entry));

        const issueItems =
          issuesResult.status === 'fulfilled'
            ? mapSuggestions('issue', issuesResult.value.results)
            : [];
        const pullItems =
          pullsResult.status === 'fulfilled'
            ? mapSuggestions('pull', pullsResult.value.results)
            : [];
        const discussionItems =
          discussionsResult.status === 'fulfilled'
            ? mapSuggestions('discussion', discussionsResult.value.results)
            : [];
        const codeItems =
          codeResult.status === 'fulfilled'
            ? mapSuggestions('code', codeResult.value.results)
            : [];

        const primarySuggestions = [...issueItems, ...pullItems, ...discussionItems, ...codeItems];
        const shortcutFallback =
          parsedSearchQuery.searchTerm.length === 0 && primarySuggestions.length === 0
            ? quickSearchSuggestions
                .filter((suggestion) => {
                  if (suggestion.type !== 'shortcut') {
                    return false;
                  }
                  const token = suggestion.queryToken?.toLowerCase() ?? '';
                  if (parsedSearchQuery.bucketTypes.length === ALL_SEARCH_BUCKETS.length) {
                    return true;
                  }
                  return parsedSearchQuery.bucketTypes.some((bucket) => token.includes(`type:${bucket}`));
                })
                .slice(0, 4)
            : [];
        const nextSuggestions = [...primarySuggestions, ...shortcutFallback].slice(0, 10);
        searchSuggestionCacheRef.current.set(searchCacheKey, nextSuggestions);
        setSearchSuggestions(nextSuggestions);
      } catch {
        if (!cancelled) {
          setSearchSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    hasToken,
    parsedSearchQuery,
    quickSearchSuggestions,
    repoFromPath,
    repoSearchContext?.id,
    repoSearchContext?.name,
    repoSearchContext?.workspaceId,
    scopedRepoForSearch,
    scopedWorkspaceForSearch,
    searchOpen,
    searchParams,
    workspaceFromPath,
    workspaceSidebarContext?.id,
    workspaceSidebarContext?.slug,
  ]);

  useEffect(() => {
    setSearchActiveIndex(0);
  }, [trimmedSearchQuery]);

  useEffect(() => {
    if (searchActiveIndex < visibleSearchSuggestions.length) {
      return;
    }
    setSearchActiveIndex(0);
  }, [searchActiveIndex, visibleSearchSuggestions.length]);

  const updateHeaderSearch = (nextValue: string) => {
    if (!isUrlSearchControlled) {
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (nextValue) {
      params.set('q', nextValue);
    } else {
      params.delete('q');
    }
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    });
  };

  const applySearchShortcutToken = useCallback(
    (token: string) => {
      const sanitizedToken = token.trim();
      if (!sanitizedToken) {
        return;
      }
      const merged = mergeShortcutTokens(trimmedSearchQuery, sanitizedToken);
      const mergedQuery = merged ? `${merged} ` : '';
      if (isUrlSearchControlled) {
        const params = new URLSearchParams(searchParams.toString());
        if (mergedQuery) {
          params.set('q', mergedQuery);
        } else {
          params.delete('q');
        }
        const queryString = params.toString();
        router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
          scroll: false,
        });
      } else {
        setLocalSearch(mergedQuery);
      }
      setSearchOpen(true);
      setSearchActiveIndex(0);
      window.setTimeout(() => focusHeaderSearch(), 0);
    },
    [
      focusHeaderSearch,
      isUrlSearchControlled,
      pathname,
      router,
      searchParams,
      trimmedSearchQuery,
    ],
  );

  const navigateToSearchSuggestion = useCallback(
    (suggestion: HeaderSearchSuggestion) => {
      if (suggestion.type === 'shortcut' && suggestion.queryToken) {
        applySearchShortcutToken(suggestion.queryToken);
        return;
      }
      setSearchOpen(false);
      setSearchActiveIndex(0);
      router.push(suggestion.href);
    },
    [applySearchShortcutToken, router],
  );

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value;
    if (isUrlSearchControlled) {
      updateHeaderSearch(nextValue);
    } else {
      setLocalSearch(nextValue);
    }
    setSearchOpen(true);
  };

  const handleSearchSubmit = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchOpen(true);
      return;
    }

    const selected =
      visibleSearchSuggestions[searchActiveIndex] ?? visibleSearchSuggestions[0] ?? null;
    if (selected && selected.type !== 'shortcut') {
      navigateToSearchSuggestion(selected);
      return;
    }

    const firstRealSuggestion =
      visibleSearchSuggestions.find((suggestion) => suggestion.type !== 'shortcut') ?? null;
    if (firstRealSuggestion) {
      navigateToSearchSuggestion(firstRealSuggestion);
      return;
    }

    setSearchOpen(true);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSearchOpen(false);
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!visibleSearchSuggestions.length) {
        return;
      }
      setSearchOpen(true);
      setSearchActiveIndex((current) =>
        current + 1 >= visibleSearchSuggestions.length ? 0 : current + 1,
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!visibleSearchSuggestions.length) {
        return;
      }
      setSearchOpen(true);
      setSearchActiveIndex((current) =>
        current - 1 < 0 ? visibleSearchSuggestions.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearchSubmit(activeSearchValue);
    }
  };

  const handleSignOut = () => {
    setIsSigningOut(true);
    void apiFetch('/me/sessions/current/revoke', {
      method: 'POST',
      suppressAuthRedirect: true,
    }).catch(() => null).finally(() => {
      clearToken();
      setHasToken(false);
      window.location.replace('/login');
    });
  };

  const modeLinks = useMemo<NavItem[]>(
    () => [
      {
        label: 'Home',
        href: '/',
        activeMatch: (path) =>
          !path.startsWith('/repositories') &&
          !path.startsWith('/workspaces') &&
          !path.startsWith('/notifications') &&
          !path.startsWith('/invites') &&
          !path.startsWith('/settings'),
      },
      {
        label: 'Repositories',
        href: '/repositories',
        activeMatch: (path) => path.startsWith('/repositories') || path.includes('/repos/'),
      },
      {
        label: 'Workspaces',
        href: '/workspaces',
        activeMatch: (path) => path.startsWith('/workspaces') && !path.includes('/repos/'),
      },
    ],
    [],
  );

  const sidebarItems = useMemo(() => {
    switch (mode) {
      case 'notifications':
        return [
          {
            label: 'Inbox',
            href: '/notifications',
            activeMatch: (path) => path === '/notifications',
          },
          {
            label: 'Mentions',
            href: '/notifications/mentions',
            activeMatch: (path) => path === '/notifications/mentions',
          },
          {
            label: 'Invites',
            href: '/notifications/invites',
            activeMatch: (path) => path === '/notifications/invites',
          },
          {
            label: 'System',
            href: '/notifications/system',
            activeMatch: (path) => path === '/notifications/system',
          },
        {
          label: 'Manage',
          href: '/notifications/manage',
          activeMatch: (path) => path === '/notifications/manage',
        },
      ] satisfies NavItem[];
      case 'account':
        return [
          { label: 'Profile', href: '/settings/profile' },
          { label: 'Account', href: '/settings/account' },
          { label: 'Developer', href: '/settings/developer' },
        ] satisfies NavItem[];
      default:
        return [
          { label: 'Overview', href: '/' },
          { label: 'Tasks', href: '/tasks' },
          { label: 'Discussions', href: '/discussions' },
          { label: 'Issues', href: '/issues' },
          { label: 'Pull requests', href: '/pulls' },
          { label: 'Activity', href: '/activity' },
        ] satisfies NavItem[];
    }
  }, [mode]);

  const contextItems = useMemo(() => {
    const isWorkspacePath = pathname.startsWith('/workspaces/');
    if (!isWorkspacePath) {
      return [] as NavItem[];
    }

    const prefix = '/workspaces/';
    const workspaceId = pathname.split(prefix)[1]?.split('/')[0];
    if (!workspaceId) {
      return [] as NavItem[];
    }

    if (pathname.includes('/repos/')) {
      const repoId = pathname.split('/repos/')[1]?.split('/')[0];
      if (!repoId) {
        return [] as NavItem[];
      }
      const repoBase = `/workspaces/${workspaceId}/repos/${repoId}`;
      return [
        {
          label: 'Code',
          href: repoBase,
          activeMatch: (path) => path === repoBase,
        },
        {
          label: 'Issues',
          href: `${repoBase}/issues`,
          activeMatch: (path) => path.startsWith(`${repoBase}/issues`),
        },
        {
          label: 'Pull requests',
          href: `${repoBase}/pulls`,
          activeMatch: (path) => path.startsWith(`${repoBase}/pulls`),
        },
        {
          label: 'Insights',
          href: `${repoBase}/insights`,
          activeMatch: (path) => path.startsWith(`${repoBase}/insights`),
        },
        {
          label: 'Share',
          href: `${repoBase}/share`,
          activeMatch: (path) => path.startsWith(`${repoBase}/share`),
        },
        {
          label: 'Access',
          href: `${repoBase}/access`,
          activeMatch: (path) => path.startsWith(`${repoBase}/access`),
        },
        {
          label: 'Settings',
          href: `${repoBase}/settings`,
          activeMatch: (path) => path.startsWith(`${repoBase}/settings`),
        },
      ] satisfies NavItem[];
    }

    const workspaceBase = `/workspaces/${workspaceId}`;
    return [
      {
        label: 'Overview',
        href: workspaceBase,
        activeMatch: (path) => path === workspaceBase,
      },
      ...(workspaceSidebarContext?.isPersonal === false
        ? ([
            {
              label: 'Access',
              href: `${workspaceBase}/access`,
              activeMatch: (path) => path.startsWith(`${workspaceBase}/access`),
            },
          ] satisfies NavItem[])
        : []),
      {
        label: 'Settings',
        href: `${workspaceBase}/settings`,
        activeMatch: (path) => path.startsWith(`${workspaceBase}/settings`),
      },
    ] satisfies NavItem[];
  }, [pathname, workspaceSidebarContext?.isPersonal]);

  const effectiveSidebarItems = useMemo(() => {
    if (mode === 'home' && contextItems.length) {
      return contextItems;
    }
    return sidebarItems;
  }, [contextItems, mode, sidebarItems]);

  const showTopPrimaryTabs = true;

  useEffect(() => {
    if (!hasToken) {
      return;
    }

    const routeCandidates = new Set<string>([
      '/notifications',
      '/settings/account',
      '/developers',
      '/repositories',
      '/workspaces',
      '/',
    ]);

    routeCandidates.forEach((href) => {
      if (!href.startsWith('/')) {
        return;
      }
      if (prefetchedRoutesRef.current.has(href)) {
        return;
      }
      try {
        router.prefetch(href);
        prefetchedRoutesRef.current.add(href);
      } catch {
        // Ignore prefetch failures to avoid interrupting navigation.
      }
    });
  }, [hasToken, router]);

  const isActive = (item: NavItem) => {
    if (item.activeMatch) {
      return item.activeMatch(pathname);
    }
    return pathname === item.href;
  };

  const renderSearchSuggestions = () => {
    if (!showSearchSuggestions) {
      return null;
    }

    return (
      <div className="portal-header-search-suggestions" role="listbox" aria-label="Search suggestions">
        {searchLoading ? (
          <div className="portal-header-search-state">Searching...</div>
        ) : visibleSearchSuggestions.length ? (
          visibleSearchSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              aria-selected={index === searchActiveIndex}
              className={`portal-header-search-option ${index === searchActiveIndex ? 'is-active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => navigateToSearchSuggestion(suggestion)}
              onMouseEnter={() => setSearchActiveIndex(index)}
            >
              <span className="portal-header-search-option-copy">
                <strong>{suggestion.title}</strong>
                <span>{suggestion.subtitle}</span>
              </span>
              <span className="portal-header-search-option-meta">
                {suggestion.type === 'issue'
                  ? 'Issue'
                  : suggestion.type === 'pull'
                    ? 'Pull'
                    : suggestion.type === 'discussion'
                      ? 'Discussion'
                      : suggestion.type === 'code'
                        ? 'Code'
                        : 'Shortcut'}
                {suggestion.status ? <em>{suggestion.status}</em> : null}
              </span>
            </button>
          ))
        ) : (
          <div className="portal-header-search-state">
            {shouldShowCodeScopeHint
              ? 'Code search needs a repo scope. Use repo:<name> or open a repository first.'
              : 'No matches. Keep typing to refine your query.'}
          </div>
        )}
      </div>
    );
  };

  if (!isHydrated) {
    return (
      <div className="portal-shell portal-shell--guest" data-theme={theme}>
        <div className="app-boot-screen" aria-hidden="true" />
      </div>
    );
  }

  if (isSigningOut) {
    return (
      <div className="portal-shell portal-shell--guest" data-theme={theme}>
        <div className="app-boot-screen" aria-hidden="true" />
      </div>
    );
  }

  if (!hasToken) {
    return (
      <div className={`portal-shell ${shellVariant}`} data-theme={theme}>
        <div className="portal-frame portal-frame-guest">
          <div className="portal-main">
            <main className="portal-canvas">
              {children}
            </main>
            <div id="portal-overlay-root" data-shell="portal" className="portal-theme-scope" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`portal-shell ${shellVariant}`} data-theme={theme}>
      <div className={`portal-frame ${sidebarCollapsed || isRepoFileView || isTasksBoardView ? 'collapsed' : ''} ${isRepoFileView ? 'repo-file-mode' : ''}`}>
        <aside className={`portal-sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed || isRepoFileView || isTasksBoardView ? 'collapsed' : ''}`}>
          <div className="portal-sidebar-section shell-brand">
            <Link href="/" aria-label="Uynis">
              <UynisLogo
                className="portal-logo"
                variant={theme === 'light' ? 'light' : 'dark'}
              />
            </Link>
            {!sidebarCollapsed ? (
              <button
                className="portal-sidebar-collapse portal-sidebar-collapse-top"
                type="button"
                onClick={() => setSidebarCollapsedPersisted(true)}
                aria-label="Collapse sidebar"
              >
                <ChevronIcon direction="left" className="portal-sidebar-chevron-icon" />
              </button>
            ) : null}
          </div>

          <div className="portal-sidebar-section portal-sidebar-nav-section">
            <ul>
              {effectiveSidebarItems.map((item) => (
                <li key={item.href}>
                  <Link
                    className={`portal-nav-item ${isActive(item) ? 'active' : ''}`}
                    href={item.href}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className="portal-nav-icon" aria-hidden="true">
                      {iconForLabel(item.label)}
                    </span>
                    <span className="portal-nav-label">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="portal-sidebar-footer">
            <WorkspaceSwitcher />
            {mode === 'account' ? (
              <button
                className="ghost small portal-sidebar-signout"
                type="button"
                onClick={handleSignOut}
              >
                Sign out
              </button>
            ) : null}
            {sidebarCollapsed ? (
              <button
                className="portal-sidebar-collapse portal-sidebar-collapse-bottom"
                type="button"
                onClick={() => setSidebarCollapsedPersisted(false)}
                aria-label="Expand sidebar"
              >
                <ChevronIcon direction="right" className="portal-sidebar-chevron-icon" />
              </button>
            ) : null}
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            type="button"
            className="portal-sidebar-backdrop"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <div className="portal-main">
          <div className="portal-header-bar portal-header-shell">
            <div className="portal-header-left">
              {showTopPrimaryTabs ? (
                <nav className="portal-header-tabs" aria-label="Primary sections">
                  {modeLinks.map((item) => (
                    <Link
                      key={item.href}
                      className={`portal-header-tab ${isActive(item) ? 'active' : ''}`}
                      href={item.href}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              ) : null}
              <label className="portal-header-searchbar">
                <span className="sr-only">Search</span>
                <span className="portal-header-search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4 4" />
                  </svg>
                </span>
                <input
                  ref={desktopSearchInputRef}
                  className="portal-header-search-input"
                  type="search"
                  placeholder={headerSearchPlaceholder}
                  value={activeSearchValue}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => setSearchOpen(true)}
                />
                {renderSearchSuggestions()}
              </label>
            </div>

          <div className="portal-header-right">
            <Link className="portal-header-account" href="/settings/profile" aria-label="Account">
              {avatarNode}
              <span className="portal-header-user-label">{userLabel}</span>
            </Link>

            <Link
              className={`portal-header-icon ${mode === 'notifications' ? 'active' : ''}`}
              href="/notifications"
              aria-label="Notifications"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 9.5a6 6 0 1 1 12 0v3.2l1.5 2.3H4.5L6 12.7z" />
                <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
              </svg>
              {notificationUnreadCount > 0 ? (
                <span
                  className="portal-header-notification-badge"
                  aria-label={`${notificationUnreadCount} unread notifications`}
                >
                  {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                </span>
              ) : null}
            </Link>

          </div>

            <div className="portal-header-mobile">
              <button
                type="button"
                className="portal-header-mobile-toggle"
                aria-label="Open sidebar"
                onClick={() => setSidebarOpen(true)}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </svg>
              </button>
              <label className="portal-header-searchbar">
                <span className="sr-only">Search</span>
                <span className="portal-header-search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="11" cy="11" r="6.5" />
                    <path d="M16 16l4 4" />
                  </svg>
                </span>
                <input
                  ref={mobileSearchInputRef}
                  className="portal-header-search-input"
                  type="search"
                  placeholder={headerSearchPlaceholder}
                  value={activeSearchValue}
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  onFocus={() => setSearchOpen(true)}
                />
                {renderSearchSuggestions()}
              </label>
            <Link
              className="portal-header-icon"
              href="/notifications"
              aria-label="Notifications"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 9.5a6 6 0 1 1 12 0v3.2l1.5 2.3H4.5L6 12.7z" />
                <path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" />
              </svg>
              {notificationUnreadCount > 0 ? (
                <span
                  className="portal-header-notification-badge"
                  aria-label={`${notificationUnreadCount} unread notifications`}
                >
                  {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                </span>
              ) : null}
            </Link>
            <Link
              href="/settings/profile"
              className="portal-header-avatar-button"
              aria-label="Profile"
            >
              {avatarNode}
              </Link>
            </div>
          </div>

          <main className="portal-canvas">
            {children}
          </main>
          <div id="portal-overlay-root" data-shell="portal" className="portal-theme-scope" />

          <nav className="portal-mobile-nav" aria-label="Primary">
            <Link
              className={`portal-mobile-item ${isActive(modeLinks[0]) ? 'active' : ''}`}
              href={modeLinks[0].href}
            >
              {iconForLabel(modeLinks[0].label)}
              <span>Home</span>
            </Link>
            <Link
              className={`portal-mobile-item ${isActive(modeLinks[1]) ? 'active' : ''}`}
              href={modeLinks[1].href}
            >
              {iconForLabel(modeLinks[1].label)}
              <span>Repos</span>
            </Link>
            <Link
              className={`portal-mobile-item ${isActive(modeLinks[2]) ? 'active' : ''}`}
              href={modeLinks[2].href}
            >
              {iconForLabel(modeLinks[2].label)}
              <span>Workspaces</span>
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}
