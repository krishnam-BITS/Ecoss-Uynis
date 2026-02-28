'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';
import { PublicShell } from '../../../../components/PublicShell';
import { RepoListRow, type RepoLanguage } from '../../../../components/RepoListRow';
import { WorkspaceHeader } from '../../../../components/WorkspaceHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import {
  PortalCardSkeleton,
  PortalCard,
  PortalEmptyState,
  PortalList,
  PortalPage,
  PortalToolbar,
} from '../../../../components/portal';
import { PortalToast } from '../../../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';
import { Button, Card, EmptyState, InlineFormRow, SectionHeader } from '../../../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
  description?: string | null;
};

type MemberRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch?: string | null;
  publicReadRequiresAuth: boolean;
  languages?: RepoLanguage[];
};

type PublicRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC';
  defaultBranch?: string | null;
  publicReadRequiresAuth: boolean;
  languages?: RepoLanguage[];
};

type PublicWorkspacePayload = {
  workspace: Workspace;
  visibility: {
    isMember: boolean;
    canViewRepos: boolean;
  };
  repos: PublicRepo[];
};

function sanitizeBranchDisplay(value: string | null | undefined) {
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

export default function WorkspaceReposPage() {
  const params = useParams<{ workspaceId: string }>();
  const searchParams = useSearchParams();
  const workspaceId = params.workspaceId;
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [repos, setRepos] = useState<MemberRepo[]>([]);
  const [publicData, setPublicData] = useState<PublicWorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvedView, setResolvedView] = useState<'member' | 'public' | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    const load = async () => {
      const isAuthenticated = Boolean(getToken());
      setIsLoading(true);
      setError(null);
      setWorkspace(null);
      setRepos([]);
      setPublicData(null);
      setResolvedView(null);
      setForbidden(false);

      try {
        const [workspaceData, repoData] = await Promise.all([
          apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}`, {
            suppressAuthRedirect: true,
          }),
          apiFetch<{ repos: MemberRepo[] }>(`/workspaces/${workspaceId}/repos`, {
            suppressAuthRedirect: true,
          }),
        ]);
        if (!workspaceData.workspace) {
          throw new Error('Workspace not found or inaccessible.');
        }
        setWorkspace(workspaceData.workspace);
        setRepos(repoData.repos);
        setResolvedView('member');
        setIsLoading(false);
        return;
      } catch (memberError) {
        if (
          isAuthenticated &&
          (!(memberError instanceof ApiRequestError) ||
            ![401, 403, 404].includes(memberError.status))
        ) {
          setError(
            memberError instanceof Error
              ? memberError.message
              : 'Unable to load workspace repositories.',
          );
          setResolvedView('member');
          setIsLoading(false);
          return;
        }
      }

      try {
        const publicWorkspace = await apiFetch<PublicWorkspacePayload>(
          `/workspaces/${workspaceId}/public`,
          { suppressAuthRedirect: true },
        );
        setWorkspace(publicWorkspace.workspace);
        setPublicData(publicWorkspace);
        setResolvedView('public');
      } catch (publicError) {
        if (
          isAuthenticated &&
          publicError instanceof ApiRequestError &&
          publicError.status === 403
        ) {
          setForbidden(true);
          setResolvedView('member');
        } else if (
          publicError instanceof ApiRequestError &&
          [401, 403, 404].includes(publicError.status)
        ) {
          setError(null);
        } else {
          setError(
            publicError instanceof Error
              ? publicError.message
              : 'Unable to load workspace repositories.',
          );
        }
        setResolvedView('public');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [workspaceId]);

  const workspaceRef = workspace?.slug ?? workspaceId;
  const filteredMemberRepos = useMemo(() => {
    if (!query) {
      return repos;
    }
    return repos.filter((repo) =>
      `${repo.name} ${repo.slug} ${repo.visibility}`.toLowerCase().includes(query),
    );
  }, [query, repos]);
  const filteredPublicRepos = useMemo(() => {
    const source = publicData?.repos ?? [];
    if (!query) {
      return source;
    }
    return source.filter((repo) => `${repo.name} ${repo.slug}`.toLowerCase().includes(query));
  }, [publicData?.repos, query]);

  if (!isHydrated) {
    return null;
  }

  if (forbidden) {
    return (
      <AppShell>
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
        <PortalPage className="workspace-repo-shell">
          <Card className="stack">
            <p className="muted">You are signed in but do not have access to this workspace.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href="/workspaces">
                Workspaces
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </InlineFormRow>
          </Card>
        </PortalPage>
      </AppShell>
    );
  }

  if (resolvedView === 'public' || (!hasToken && resolvedView !== 'member')) {
    return (
      <PublicShell mode="landing">
        <section className="site-canvas-section">
          <PortalPage className="workspace-repo-shell">
            {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
            <PortalToolbar
              title={workspace ? `${workspace.name} repositories` : 'Repositories'}
              subtitle={
                publicData?.visibility.canViewRepos
                  ? 'Public repositories in this workspace.'
                  : 'This workspace does not expose repository listings.'
              }
            />
            {!isLoading && publicData?.visibility.canViewRepos ? (
              <PortalList>
                {filteredPublicRepos.length ? (
                  <ul className="list">
                    {filteredPublicRepos.map((repo) => (
                      <li key={repo.id} className="queue-item repo-list-row">
                        <div className="repo-list-row-main">
                          <div className="repo-list-row-left">
                            <strong className="repo-list-row-title">{repo.name}</strong>
                            {repo.publicReadRequiresAuth && !hasToken ? (
                              <span className="muted">Sign in required to open this repo.</span>
                            ) : null}
                          </div>
                          <div className="repo-list-row-right">
                            <span className="repo-list-row-branch-text">
                              default: {sanitizeBranchDisplay(repo.defaultBranch)}
                            </span>
                        <span className="portal-badge public repo-list-row-control">PUBLIC</span>
                        {repo.publicReadRequiresAuth && !hasToken ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="repo-list-row-control"
                                href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceRef}/repos/${repo.slug}`)}`}
                              >
                                Login to contribute
                              </Button>
                            ) : (
                              <Button
                                variant="primary"
                                size="sm"
                                className="repo-list-row-control repo-list-row-open"
                                href={`/workspaces/${workspaceRef}/repos/${repo.slug}`}
                              >
                                Open
                              </Button>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <PortalEmptyState message="No public repositories available." />
                )}
              </PortalList>
            ) : (
              <>
                {isLoading ? (
                  <PortalCardSkeleton lines={4} />
                ) : (
                  <Card>
                    <p className="muted">
                      Sign in to view private repositories or contribute to public repositories.
                    </p>
                  </Card>
                )}
              </>
            )}
          </PortalPage>
        </section>
      </PublicShell>
    );
  }

  return (
    <AppShell>
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      <WorkspaceHeader workspaceId={workspaceRef} workspace={workspace} />
      {workspace ? (
        <WorkspaceNav
          workspaceId={workspaceRef}
          active="overview"
          viewerRole={workspace.viewerRole}
          isPersonal={workspace.isPersonal}
        />
      ) : null}
      <PortalPage className="workspace-repo-shell">
        <PortalToolbar
          title="Workspace repositories"
          subtitle={
            query
              ? `Showing ${filteredMemberRepos.length} of ${repos.length} repositories`
              : `${repos.length} repositories in this workspace`
          }
          actions={
            <div className="workspace-repo-toolbar-actions">
              <Button variant="primary" size="sm" href={`/repositories?workspace=${workspaceId}`}>
                Create or import repository
              </Button>
            </div>
          }
        />
        <PortalList>
          {isLoading ? (
            <div className="portal-skeleton-grid">
              {Array.from({ length: 3 }).map((_, index) => (
                <PortalCardSkeleton key={`repo-list-skeleton-${index}`} lines={3} />
              ))}
            </div>
          ) : filteredMemberRepos.length ? (
            <ul className="list">
              {filteredMemberRepos.map((repo) => (
                <RepoListRow
                  key={repo.id}
                  name={repo.name}
                  defaultBranch={repo.defaultBranch}
                  visibility={repo.visibility}
                  languages={repo.languages}
                  href={`/workspaces/${workspaceRef}/repos/${repo.slug}`}
                />
              ))}
            </ul>
          ) : (
            <PortalEmptyState
              message={query ? 'No repositories match this search.' : 'No repositories yet.'}
            />
          )}
        </PortalList>
      </PortalPage>
    </AppShell>
  );
}

