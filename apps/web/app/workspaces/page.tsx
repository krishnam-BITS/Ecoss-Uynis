'use client';

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { apiFetch } from '../../lib/api';
import {
  getSelectedWorkspaceId,
  setSelectedWorkspaceId,
  WORKSPACE_SELECTION_EVENT,
} from '../../lib/workspace';
import {
  PortalCardSkeleton,
  PortalModal,
  PortalPage,
  PortalToolbar,
} from '../../components/portal';
import { PortalToast } from '../../components/PortalToast';
import { Button, Card, EmptyState, InlineFormRow } from '../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
};

type WorkspaceStats = {
  repoCount: number;
  openIssues: number;
  openPulls: number;
};

const workspaceMatchesQuery = (workspace: Workspace, query: string) =>
  `${workspace.name} ${workspace.slug}`.toLowerCase().includes(query);

function WorkspaceScopeIcon({ isPersonal }: { isPersonal?: boolean }) {
  if (isPersonal) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <circle cx="12" cy="8.5" r="3.2" />
        <path d="M6.5 19c1.1-3 3.2-4.6 5.5-4.6s4.4 1.6 5.5 4.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="9" r="2.7" />
      <circle cx="16" cy="9" r="2.7" />
      <path d="M3.8 19c0-2.6 2.1-4.1 4.2-4.1s4.2 1.5 4.2 4.1" />
      <path d="M11.8 19c0-2.6 2.1-4.1 4.2-4.1s4.2 1.5 4.2 4.1" />
    </svg>
  );
}

export default function WorkspacesPage() {
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [statsByWorkspace, setStatsByWorkspace] = useState<Record<string, WorkspaceStats>>({});
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const data = await apiFetch<{ workspaces?: Workspace[] }>('/workspaces');
        const workspaceList = data.workspaces ?? [];
        if (cancelled) {
          return;
        }
        setWorkspaces(workspaceList);

        const selectedWorkspaceId = getSelectedWorkspaceId();
        const selectedWorkspace = selectedWorkspaceId
          ? workspaceList.find(
              (workspace) =>
                workspace.id === selectedWorkspaceId ||
                workspace.slug === selectedWorkspaceId,
            )
          : null;
        const nextWorkspaceId =
          selectedWorkspace?.id ??
          workspaceList.find((workspace) => workspace.isPersonal)?.id ??
          workspaceList[0]?.id ??
          '';

        if (nextWorkspaceId) {
          setSelectedWorkspaceId(nextWorkspaceId);
          setActiveWorkspaceId(nextWorkspaceId);
        }

        // Render directory immediately, then hydrate stats in the background.
        setIsLoading(false);
        void (async () => {
          const statsEntries = await Promise.all(
            workspaceList.map(async (workspace) => {
              try {
                const statsData = await apiFetch<{ stats: WorkspaceStats }>(
                  `/workspaces/${workspace.id}/stats`,
                );
                return [workspace.id, statsData.stats] as const;
              } catch {
                return [
                  workspace.id,
                  {
                    repoCount: 0,
                    openIssues: 0,
                    openPulls: 0,
                  } satisfies WorkspaceStats,
                ] as const;
              }
            }),
          );
          if (!cancelled) {
            setStatsByWorkspace(Object.fromEntries(statsEntries));
          }
        })();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load workspaces.');
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncSelectedWorkspace = () => {
      const selected = getSelectedWorkspaceId();
      if (selected) {
        setActiveWorkspaceId(selected);
      }
    };
    window.addEventListener(
      WORKSPACE_SELECTION_EVENT,
      syncSelectedWorkspace as EventListener,
    );
    window.addEventListener('storage', syncSelectedWorkspace);
    return () => {
      window.removeEventListener(
        WORKSPACE_SELECTION_EVENT,
        syncSelectedWorkspace as EventListener,
      );
      window.removeEventListener('storage', syncSelectedWorkspace);
    };
  }, []);

  const filteredWorkspaces = useMemo(() => {
    const list = query
      ? workspaces.filter((workspace) => workspaceMatchesQuery(workspace, query))
      : workspaces;
    return [...list].sort((left, right) => {
      if (Boolean(left.isPersonal) !== Boolean(right.isPersonal)) {
        return left.isPersonal ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [query, workspaces]);

  const teamWorkspaceCount = useMemo(
    () => workspaces.filter((workspace) => !workspace.isPersonal).length,
    [workspaces],
  );

  const totalRepoCount = useMemo(
    () => Object.values(statsByWorkspace).reduce((sum, stats) => sum + stats.repoCount, 0),
    [statsByWorkspace],
  );

  const activeWorkspace = useMemo(
    () =>
      workspaces.find(
        (workspace) =>
          workspace.id === activeWorkspaceId || workspace.slug === activeWorkspaceId,
      ) ?? null,
    [activeWorkspaceId, workspaces],
  );

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsCreating(true);
    try {
      const data = await apiFetch<{ workspace?: Workspace }>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug: slug.trim() || undefined,
        }),
      });
      const createdWorkspace = data.workspace;
      if (!createdWorkspace) {
        throw new Error('Workspace was created but API response was empty.');
      }
      setWorkspaces((prev) => [createdWorkspace, ...prev]);
      setStatsByWorkspace((prev) => ({
        ...prev,
        [createdWorkspace.id]: {
          repoCount: 0,
          openIssues: 0,
          openPulls: 0,
        },
      }));
      setActiveWorkspaceId(createdWorkspace.id);
      setSelectedWorkspaceId(createdWorkspace.id);
      setName('');
      setSlug('');
      setIsCreateOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create workspace.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleWorkspaceSelect = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setSelectedWorkspaceId(workspaceId);
  };

  const handleWorkspaceKeyDown = (event: ReactKeyboardEvent<HTMLElement>, workspaceId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleWorkspaceSelect(workspaceId);
    }
  };

  return (
    <AppShell title="Workspaces">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      <PortalPage className="workspace-shell workspace-selection-shell">
        <PortalToolbar
          title="Workspaces"
          actions={(
            <div className="workspace-toolbar-actions">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setIsCreateOpen(true)}
              >
                Create workspace
              </Button>
            </div>
          )}
        />

        <Card className="canvas-card workspace-directory-summary">
          <div className="repo-index-summary-grid">
            <div className="repo-index-summary-item">
              <span>Total workspaces</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div className="repo-index-summary-item">
              <span>Team workspaces</span>
              <strong>{teamWorkspaceCount}</strong>
            </div>
            <div className="repo-index-summary-item">
              <span>Total repositories</span>
              <strong>{totalRepoCount}</strong>
            </div>
          </div>
        </Card>

        <section className="workspace-directory-section">
          {isLoading ? (
            <div className="workspace-card-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <PortalCardSkeleton key={`workspace-skeleton-${index}`} lines={3} />
              ))}
            </div>
          ) : filteredWorkspaces.length ? (
            <div className="workspace-card-grid">
              {filteredWorkspaces.map((workspace) => {
                const workspaceStats = statsByWorkspace[workspace.id] ?? {
                  repoCount: 0,
                  openIssues: 0,
                  openPulls: 0,
                };
                return (
                  <article
                    key={workspace.id}
                    className={`workspace-directory-card ${
                      activeWorkspaceId === workspace.id ||
                      activeWorkspaceId === workspace.slug
                        ? 'is-active'
                        : ''
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleWorkspaceSelect(workspace.id)}
                    onKeyDown={(event) => handleWorkspaceKeyDown(event, workspace.id)}
                  >
                    <h3 className="workspace-card-name">{workspace.name}</h3>
                    <div className="workspace-card-footer">
                      <div className="workspace-card-footer-left">
                        <span
                          className={`workspace-card-scope ${workspace.isPersonal ? 'personal' : 'team'}`}
                          aria-label={workspace.isPersonal ? 'Personal workspace' : 'Team workspace'}
                        >
                          <WorkspaceScopeIcon isPersonal={workspace.isPersonal} />
                        </span>
                        <div className="workspace-card-stats">
                          <span
                            className="workspace-card-stat"
                            aria-label={`${workspaceStats.repoCount} repositories`}
                            title="Repositories"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                              <path d="M4 6.5c0-1 1-1.8 2.2-1.8h11.6c1.2 0 2.2.8 2.2 1.8v11c0 1-1 1.8-2.2 1.8H6.2C5 19.3 4 18.5 4 17.5z" />
                              <path d="M8 8.5h8" />
                              <path d="M8 12h8" />
                            </svg>
                            {workspaceStats.repoCount}
                          </span>
                          <span
                            className="workspace-card-stat"
                            aria-label={`${workspaceStats.openIssues} open issues`}
                            title="Open issues"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                              <circle cx="12" cy="12" r="8" />
                              <path d="M12 8v5" />
                              <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
                            </svg>
                            {workspaceStats.openIssues}
                          </span>
                          <span
                            className="workspace-card-stat"
                            aria-label={`${workspaceStats.openPulls} open pull requests`}
                            title="Open pull requests"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                              <circle cx="7" cy="7" r="2.2" />
                              <circle cx="17" cy="17" r="2.2" />
                              <path d="M7 9.5v7.5" />
                              <path d="M17 14V7" />
                              <path d="M17 7h-5" />
                            </svg>
                            {workspaceStats.openPulls}
                          </span>
                        </div>
                      </div>
                      <div className="workspace-card-actions">
                        <Button
                          className="workspace-card-open"
                          variant={
                            activeWorkspaceId === workspace.id || activeWorkspaceId === workspace.slug
                              ? 'primary'
                              : 'ghost'
                          }
                          size="sm"
                          href={`/workspaces/${workspace.slug}`}
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={query ? 'No workspaces match your search.' : 'No workspaces yet.'}
            />
          )}
        </section>

        <PortalModal
          open={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Create workspace"
          subtitle="Add a shared workspace for repositories, teams, and members."
          panelClassName="workspace-create-modal"
        >
          <form className="stack" onSubmit={handleCreate}>
            <label className="field">
              <span>Workspace name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Platform Ops"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Workspace slug (optional)</span>
              <input
                type="text"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="platform-ops"
              />
            </label>
            <InlineFormRow className="workspace-modal-actions" align="start">
              <Button variant="primary" type="submit" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create workspace'}
              </Button>
            </InlineFormRow>
          </form>
        </PortalModal>
      </PortalPage>
    </AppShell>
  );
}

