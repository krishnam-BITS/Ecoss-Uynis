'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getToken } from '../lib/auth';
import { GIT_BASE_URL } from '../lib/config';
import { apiFetch } from '../lib/api';
import { PortalToast } from './PortalToast';

type RepoNotificationMode = 'DEFAULT' | 'WATCH' | 'MUTE';

type RepoHeaderProps = {
  workspaceId: string;
  repoId: string;
  repo: {
    name?: string;
    slug?: string;
    description?: string | null;
    visibility?: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
    defaultBranch?: string;
    viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | 'OWNER' | null;
    forkedFrom?: {
      id: string;
      name?: string;
      slug?: string;
      workspaceId: string;
      workspace?: {
        slug?: string;
      };
    } | null;
    workspace?: {
      slug?: string;
    };
  } | null;
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
  commitCount?: number;
};

function sanitizeBranchDisplay(value: string | null | undefined): string {
  if (!value) {
    return 'main';
  }
  let next = value.trim();
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
  return (
    next
      .replace(/^refs\/heads\//, '')
      .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}/gi, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/%+$/g, '')
      .trim() || 'main'
  );
}

function RepoActionIcon({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span className="repo-action-icon" aria-hidden="true">
      {children}
    </span>
  );
}

export function RepoHeader({
  workspaceId,
  repoId,
  repo,
  languages = [],
  commitCount = 0,
}: RepoHeaderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [watchMode, setWatchMode] = useState<RepoNotificationMode>('DEFAULT');
  const [watchStatus, setWatchStatus] = useState<string | null>(null);
  const [isLoadingWatchMode, setIsLoadingWatchMode] = useState(false);
  const [isSavingWatchMode, setIsSavingWatchMode] = useState(false);
  const [starCount, setStarCount] = useState(0);
  const [viewerHasStar, setViewerHasStar] = useState(false);
  const [isLoadingStar, setIsLoadingStar] = useState(false);
  const [isSavingStar, setIsSavingStar] = useState(false);
  const [starStatus, setStarStatus] = useState<string | null>(null);
  const [viewerHasPin, setViewerHasPin] = useState(false);
  const [isLoadingPin, setIsLoadingPin] = useState(false);
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [pinStatus, setPinStatus] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [forkStatus, setForkStatus] = useState<string | null>(null);
  const cloneRef = useRef<HTMLDivElement | null>(null);
  const watchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const storedToken = getToken();
    setHasToken(Boolean(storedToken));
    setToken(storedToken);
  }, []);

  const workspaceSlug = repo?.workspace?.slug ?? workspaceId;
  const repoSlug = repo?.slug ?? repoId;
  const queryString = searchParams.toString();
  const visibility = repo?.visibility;
  const viewerRole = repo?.viewerRole;
  const showInsights = pathname.includes('/workspaces/') && pathname.includes('/repos/');
  const cloneUrl = useMemo(
    () => `${GIT_BASE_URL}/${workspaceSlug}/${repoSlug}.git`,
    [workspaceSlug, repoSlug],
  );
  const authCloneCommand = useMemo(() => {
    if (!token) {
      return '';
    }
    return `git -c http.extraHeader="Authorization: Bearer ${token}" clone ${cloneUrl}`;
  }, [cloneUrl, token]);

  const watchLabel =
    watchMode === 'WATCH'
      ? 'Watching'
      : watchMode === 'MUTE'
        ? 'Muted'
        : 'Watch';
  const actionNotice = forkStatus ?? pinStatus ?? starStatus ?? watchStatus ?? null;
  const actionNoticeTone =
    actionNotice && /^unable\b/i.test(actionNotice) ? 'error' : 'success';

  const loadWatchMode = useCallback(async () => {
    if (!hasToken) {
      setWatchMode('DEFAULT');
      return;
    }
    setIsLoadingWatchMode(true);
    setWatchStatus(null);
    try {
      const data = await apiFetch<{
        preference: { mode: RepoNotificationMode };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/notification-preferences`, {
        suppressAuthRedirect: true,
      });
      setWatchMode(data.preference.mode);
    } catch {
      setWatchMode('DEFAULT');
    } finally {
      setIsLoadingWatchMode(false);
    }
  }, [hasToken, workspaceId, repoId]);

  const setWatchPreference = async (nextMode: RepoNotificationMode) => {
    if (!hasToken || isSavingWatchMode) {
      return;
    }

    setIsSavingWatchMode(true);
    setWatchStatus(null);
    try {
      const data = await apiFetch<{
        preference: { mode: RepoNotificationMode };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/notification-preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ mode: nextMode }),
        suppressAuthRedirect: true,
      });
      setWatchMode(data.preference.mode);
      setWatchStatus(
        data.preference.mode === 'WATCH'
          ? 'Watching this repository.'
          : data.preference.mode === 'MUTE'
            ? 'Muted this repository.'
            : 'Using default notifications.',
      );
      setWatchOpen(false);
    } catch (error) {
      setWatchStatus(
        error instanceof Error ? error.message : 'Unable to update watch mode.',
      );
    } finally {
      setIsSavingWatchMode(false);
    }
  };

  const loadStarStatus = useCallback(async () => {
    setIsLoadingStar(true);
    try {
      const data = await apiFetch<{
        stars: { count: number; viewerHasStar: boolean };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/stars`, {
        suppressAuthRedirect: true,
      });
      setStarCount(data.stars.count);
      setViewerHasStar(data.stars.viewerHasStar);
    } catch {
      setStarCount(0);
      setViewerHasStar(false);
    } finally {
      setIsLoadingStar(false);
    }
  }, [workspaceId, repoId]);

  const loadPinStatus = useCallback(async () => {
    if (!hasToken) {
      setViewerHasPin(false);
      return;
    }
    setIsLoadingPin(true);
    try {
      const data = await apiFetch<{
        pin: { viewerHasPin: boolean };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/pin`, {
        suppressAuthRedirect: true,
      });
      setViewerHasPin(data.pin.viewerHasPin);
    } catch {
      setViewerHasPin(false);
    } finally {
      setIsLoadingPin(false);
    }
  }, [hasToken, workspaceId, repoId]);

  const toggleStar = async () => {
    if (!hasToken || isSavingStar) {
      return;
    }

    setIsSavingStar(true);
    setStarStatus(null);
    try {
      const data = await apiFetch<{
        star: { count: number; viewerHasStar: boolean };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/star`, {
        method: viewerHasStar ? 'DELETE' : 'PUT',
        suppressAuthRedirect: true,
      });
      setStarCount(data.star.count);
      setViewerHasStar(data.star.viewerHasStar);
      setStarStatus(
        data.star.viewerHasStar ? 'Repository starred.' : 'Star removed.',
      );
    } catch (error) {
      setStarStatus(
        error instanceof Error ? error.message : 'Unable to update star.',
      );
    } finally {
      setIsSavingStar(false);
    }
  };

  const togglePin = async () => {
    if (!hasToken || isSavingPin) {
      return;
    }

    setIsSavingPin(true);
    setPinStatus(null);
    try {
      const data = await apiFetch<{
        pin: { viewerHasPin: boolean };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/pin`, {
        method: viewerHasPin ? 'DELETE' : 'PUT',
        suppressAuthRedirect: true,
      });
      setViewerHasPin(data.pin.viewerHasPin);
      setPinStatus(data.pin.viewerHasPin ? 'Pinned to dashboard.' : 'Pin removed.');
    } catch (error) {
      setPinStatus(error instanceof Error ? error.message : 'Unable to update pin.');
    } finally {
      setIsSavingPin(false);
    }
  };

  const forkRepository = async () => {
    if (!hasToken || isForking) {
      return;
    }

    setIsForking(true);
    setForkStatus(null);
    try {
      const data = await apiFetch<{
        repo: {
          id: string;
          slug?: string | null;
          workspaceId?: string | null;
          workspaceSlug?: string | null;
        };
      }>(`/workspaces/${workspaceId}/repos/${repoId}/fork`, {
        method: 'POST',
        body: JSON.stringify({}),
        suppressAuthRedirect: true,
      });
      const targetWorkspaceRef = data.repo.workspaceSlug ?? data.repo.workspaceId;
      const targetRepoRef = data.repo.slug ?? data.repo.id;
      if (!targetWorkspaceRef || !targetRepoRef) {
        throw new Error('Fork completed but target workspace is missing.');
      }
      setForkStatus('Fork created. Redirecting...');
      window.location.assign(`/workspaces/${targetWorkspaceRef}/repos/${targetRepoRef}`);
    } catch (error) {
      setForkStatus(error instanceof Error ? error.message : 'Unable to fork.');
      setIsForking(false);
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy failed');
    } finally {
      setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  useEffect(() => {
    if (!cloneOpen && !watchOpen) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (cloneRef.current && !cloneRef.current.contains(target)) {
        setCloneOpen(false);
      }
      if (watchRef.current && !watchRef.current.contains(target)) {
        setWatchOpen(false);
      }
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCloneOpen(false);
        setWatchOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [cloneOpen, watchOpen]);

  useEffect(() => {
    void Promise.all([loadWatchMode(), loadStarStatus(), loadPinStatus()]);
  }, [loadPinStatus, loadStarStatus, loadWatchMode]);

  useEffect(() => {
    if (!watchStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setWatchStatus(null);
    }, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [watchStatus]);

  useEffect(() => {
    if (!starStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStarStatus(null);
    }, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [starStatus]);

  useEffect(() => {
    if (!pinStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPinStatus(null);
    }, 2200);
    return () => window.clearTimeout(timeoutId);
  }, [pinStatus]);

  useEffect(() => {
    if (!repo?.workspace?.slug || !repo?.slug) {
      return;
    }
    const match = pathname.match(/^\/workspaces\/([^/]+)\/repos\/([^/]+)(\/.*)?$/);
    if (!match) {
      return;
    }
    const pathWorkspaceRef = match[1];
    const pathRepoRef = match[2];
    const suffix = match[3] ?? '';
    if (pathWorkspaceRef === workspaceSlug && pathRepoRef === repoSlug) {
      return;
    }
    router.replace(
      `/workspaces/${workspaceSlug}/repos/${repoSlug}${suffix}${
        queryString ? `?${queryString}` : ''
      }`,
    );
  }, [
    pathname,
    queryString,
    repo?.slug,
    repo?.workspace?.slug,
    repoSlug,
    router,
    workspaceSlug,
  ]);
  const accessLabel =
    viewerRole === 'OWNER'
      ? 'Owner access'
      : viewerRole === 'ADMIN'
      ? 'Admin access'
      : viewerRole === 'WRITE'
        ? 'Write access'
        : viewerRole === 'READ'
          ? 'Read-only'
          : visibility === 'PUBLIC'
            ? 'Read-only'
            : null;

  return (
    <section className="repo-header">
      <div className="repo-header-top">
        <div className="repo-meta">
          <p className="repo-path">
            <Link href={`/workspaces/${workspaceSlug}`}>{workspaceSlug}</Link>
            <span>/</span>
            <Link href={`/workspaces/${workspaceSlug}/repos/${repoSlug}`}>{repoSlug}</Link>
          </p>
          <h2 className="repo-title">{repo?.name ?? 'Repository'}</h2>
          <div className="row repo-summary-row">
            {visibility ? (
              <span className={`visibility-badge ${visibility.toLowerCase()}`}>
                {visibility}
              </span>
            ) : (
              <span className="muted">Loading visibility...</span>
            )}
            {accessLabel ? (
              <span className="access-badge">{accessLabel}</span>
            ) : null}
            {repo?.defaultBranch ? (
              <span className="repo-meta-pill">Default: {sanitizeBranchDisplay(repo.defaultBranch)}</span>
            ) : null}
            {repo?.forkedFrom ? (
              <span className="repo-meta-pill">
                Forked from{' '}
                <Link
                  href={`/workspaces/${
                    repo.forkedFrom.workspace?.slug ?? repo.forkedFrom.workspaceId
                  }/repos/${repo.forkedFrom.slug ?? repo.forkedFrom.id}`}
                >
                  {(repo.forkedFrom.workspace?.slug ??
                    repo.forkedFrom.workspaceId)}/
                  {repo.forkedFrom.slug ?? repo.forkedFrom.name ?? 'source'}
                </Link>
              </span>
            ) : null}
            <span className="repo-meta-pill">Recent commits: {commitCount}</span>
          </div>
        </div>
        <div className="repo-actions">
        <div className="clone-menu" ref={cloneRef}>
          <button
            className="ghost small clone-trigger repo-icon-action"
            type="button"
            onClick={() => setCloneOpen((open) => !open)}
            aria-expanded={cloneOpen}
            aria-label="Clone repository"
            title="Clone repository"
          >
            <RepoActionIcon>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="8" cy="6.5" r="2.4" />
                <circle cx="16" cy="17.5" r="2.4" />
                <path d="M9.8 7.9l4.4 8.2" />
              </svg>
            </RepoActionIcon>
          </button>
          {cloneOpen ? (
            <div className="clone-panel">
              <p className="muted">HTTPS</p>
              <div className="code-block">
                <span className="code-text">{cloneUrl}</span>
                <button
                  className="ghost small"
                  type="button"
                    onClick={() => handleCopy(cloneUrl)}
                  >
                    Copy
                  </button>
                </div>
              {authCloneCommand ? (
                <>
                  <p className="muted">Authenticated clone</p>
                  <div className="code-block">
                    <span className="code-text">{authCloneCommand}</span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() => handleCopy(authCloneCommand)}
                    >
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">Sign in for token-based clone.</p>
              )}
              {copyStatus ? <p className="muted">{copyStatus}</p> : null}
            </div>
          ) : null}
        </div>
        <div className="watch-menu" ref={watchRef}>
          <button
            className={`ghost small repo-icon-action ${watchMode === 'WATCH' ? 'watching' : ''}`}
            type="button"
            disabled={!hasToken || isLoadingWatchMode}
            title={
              hasToken
                ? `Notifications: ${watchLabel}`
                : 'Sign in to manage watch mode'
            }
            aria-expanded={watchOpen}
            onClick={() => setWatchOpen((open) => !open)}
            aria-label={watchLabel}
          >
            <RepoActionIcon>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 5a5 5 0 0 1 5 5v3.3l1.7 2.2H5.3L7 13.3V10a5 5 0 0 1 5-5z" />
                <path d="M10 18.2a2 2 0 0 0 4 0" />
              </svg>
            </RepoActionIcon>
          </button>
          {watchOpen ? (
            <div className="watch-panel">
              <button
                className={`watch-option ${watchMode === 'WATCH' ? 'active' : ''}`}
                type="button"
                disabled={isSavingWatchMode}
                onClick={() => void setWatchPreference('WATCH')}
              >
                <strong>Watch</strong>
                <span className="muted">
                  Get all activity notifications from this repo.
                </span>
              </button>
              <button
                className={`watch-option ${watchMode === 'DEFAULT' ? 'active' : ''}`}
                type="button"
                disabled={isSavingWatchMode}
                onClick={() => void setWatchPreference('DEFAULT')}
              >
                <strong>Default</strong>
                <span className="muted">
                  Use normal notifications from your participation.
                </span>
              </button>
              <button
                className={`watch-option ${watchMode === 'MUTE' ? 'active' : ''}`}
                type="button"
                disabled={isSavingWatchMode}
                onClick={() => void setWatchPreference('MUTE')}
              >
                <strong>Mute</strong>
                <span className="muted">
                  Silence most notifications from this repository.
                </span>
              </button>
            </div>
          ) : null}
        </div>
        <button
          className={`ghost small repo-icon-action ${viewerHasStar ? 'starred' : ''}`}
          type="button"
          onClick={() => void toggleStar()}
          disabled={!hasToken || isLoadingStar || isSavingStar}
          title={hasToken ? 'Star repository' : 'Sign in to star'}
          aria-label={viewerHasStar ? 'Starred' : 'Star'}
        >
          <RepoActionIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 4.8l2.2 4.5 5 .7-3.6 3.4.9 4.8L12 16l-4.5 2.2.9-4.8-3.6-3.4 5-.7z" />
            </svg>
          </RepoActionIcon>
          {starCount ? <span className="repo-action-count">{starCount}</span> : null}
        </button>
        <button
          className={`ghost small repo-icon-action ${viewerHasPin ? 'watching' : ''}`}
          type="button"
          onClick={() => void togglePin()}
          disabled={!hasToken || isLoadingPin || isSavingPin}
          title={hasToken ? 'Pin repository' : 'Sign in to pin'}
          aria-label={viewerHasPin ? 'Pinned' : 'Pin'}
        >
          <RepoActionIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M8.5 4.5h7l-1.7 6.2 2.7 2.7H7.5l2.7-2.7z" />
              <path d="M12 13.5v5.5" />
            </svg>
          </RepoActionIcon>
        </button>
          <button
          className="ghost small repo-icon-action"
          type="button"
          disabled={!hasToken || isForking}
          title={hasToken ? 'Fork repository' : 'Sign in to fork'}
          onClick={() => void forkRepository()}
          aria-label="Fork"
          >
            <RepoActionIcon>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="7" cy="6.5" r="2.2" />
              <circle cx="17" cy="17.5" r="2.2" />
              <path d="M7 8.7v6.6a2.8 2.8 0 0 0 2.8 2.8h4.9" />
              <path d="M17 15.3V8.7a2.8 2.8 0 0 0-2.8-2.8H9.8" />
            </svg>
          </RepoActionIcon>
          </button>
        </div>
      </div>
      {showInsights ? (
        <div className="repo-header-insights">
          <div className="repo-header-about">
            <span className="repo-header-caption">About</span>
            <p className="muted">{repo?.description?.trim() || 'No repository description.'}</p>
          </div>
          <div className="repo-header-languages">
            <span className="repo-header-caption">Languages</span>
            {languages.length ? (
              <>
                <div className="repo-language-bar">
                  {languages.map((item) => (
                    <span
                      key={item.language}
                      className="repo-language-segment"
                      style={{
                        width: `${item.percent}%`,
                        backgroundColor: item.color || 'var(--border)',
                      }}
                    />
                  ))}
                </div>
                <div className="repo-language-list">
                  {languages.map((item) => (
                    <span key={item.language} className="repo-language-item">
                      <span
                        className="repo-language-dot"
                        style={{ backgroundColor: item.color || 'var(--border)' }}
                      />
                      <span>{item.language}</span>
                      <span>{item.percent.toFixed(item.percent < 10 ? 1 : 0)}%</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted">Language map builds after repository indexing.</p>
            )}
          </div>
        </div>
      ) : null}
      {actionNotice ? (
        <PortalToast
          message={actionNotice}
          tone={actionNoticeTone}
          onClose={() => {
            setForkStatus(null);
            setPinStatus(null);
            setStarStatus(null);
            setWatchStatus(null);
          }}
        />
      ) : null}
    </section>
  );
}

