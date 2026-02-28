'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../components/AppShell';
import { PublicShell } from '../../../components/PublicShell';
import { RepoListRow, type RepoLanguage } from '../../../components/RepoListRow';
import { WorkspaceHeader } from '../../../components/WorkspaceHeader';
import { WorkspaceNav } from '../../../components/WorkspaceNav';
import { getToken } from '../../../lib/auth';
import { ApiRequestError, apiFetch } from '../../../lib/api';
import {
  PortalCardSkeleton,
  PortalCard,
  PortalEmptyState,
  PortalList,
  PortalPage,
} from '../../../components/portal';
import { PortalToast } from '../../../components/PortalToast';
import { Button, Card, EmptyState, InlineFormRow, SectionHeader } from '../../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
  description?: string | null;
  website?: string | null;
  publicProfileEnabled?: boolean;
  publicProfileShowDetails?: boolean;
  publicProfileShowDescription?: boolean;
  publicProfileShowWebsite?: boolean;
  publicProfileShowRepos?: boolean;
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

type WorkspaceStats = {
  repoCount: number;
  openIssues: number;
  openPulls: number;
};

type MemberRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch?: string | null;
  publicReadRequiresAuth: boolean;
  languageBytes?: number;
  languages?: RepoLanguage[];
};

type PublicRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC';
  publicReadRequiresAuth: boolean;
  defaultBranch: string;
  updatedAt: string;
  languageBytes?: number;
  languages?: RepoLanguage[];
};

type PublicWorkspacePayload = {
  workspace: Workspace;
  visibility: {
    isMember: boolean;
    canViewDetails: boolean;
    canViewDescription: boolean;
    canViewWebsite: boolean;
    canViewRepos: boolean;
  };
  stats: {
    publicRepoCount: number;
    openIssues: number;
    openPulls: number;
  };
  repos: PublicRepo[];
};

export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspaceId: string }>();
  const searchParams = useSearchParams();
  const workspaceId = params.workspaceId;
  const repoQuery = (searchParams.get('q') ?? '').trim().toLowerCase();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [memberStats, setMemberStats] = useState<WorkspaceStats | null>(null);
  const [memberRepos, setMemberRepos] = useState<MemberRepo[]>([]);
  const [publicData, setPublicData] = useState<PublicWorkspacePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [authState, setAuthState] = useState({ isHydrated: false, hasToken: false });
  const { isHydrated, hasToken } = authState;
  const [resolvedView, setResolvedView] = useState<'member' | 'public' | null>(null);

  const workspaceRef = workspace?.slug ?? workspaceId;
  const isMemberView = resolvedView === 'member';
  const showPublicShell = resolvedView === 'public' || (!hasToken && resolvedView !== 'member');
  const shouldShowRepoList = true;
  const filteredMemberRepos = useMemo(
    () =>
      repoQuery
        ? memberRepos.filter((repo) =>
            `${repo.name} ${repo.slug} ${repo.visibility}`.toLowerCase().includes(repoQuery),
          )
        : memberRepos,
    [memberRepos, repoQuery],
  );

  useEffect(() => {
    const syncToken = () => {
      setAuthState({
        hasToken: Boolean(getToken()),
        isHydrated: true,
      });
    };
    syncToken();
    window.addEventListener('focus', syncToken);
    window.addEventListener('storage', syncToken);
    return () => {
      window.removeEventListener('focus', syncToken);
      window.removeEventListener('storage', syncToken);
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!workspaceId) {
        return;
      }
      const isAuthenticated = Boolean(getToken());

      setIsLoading(true);
      setError(null);
      setWorkspace(null);
      setMemberStats(null);
      setMemberRepos([]);
      setPublicData(null);
      setResolvedView(null);
      setForbidden(false);

      try {
        const memberData = await apiFetch<{ workspace?: Workspace }>(
          `/workspaces/${workspaceId}`,
          { suppressAuthRedirect: true },
        );

        if (!memberData.workspace) {
          throw new Error('Workspace not found or inaccessible.');
        }

        setWorkspace(memberData.workspace);
        setResolvedView('member');

        const [statsResult, reposResult] = await Promise.allSettled([
          apiFetch<{ stats: WorkspaceStats }>(`/workspaces/${workspaceId}/stats`, {
            suppressAuthRedirect: true,
          }),
          apiFetch<{ repos: MemberRepo[] }>(`/workspaces/${workspaceId}/repos`, {
            suppressAuthRedirect: true,
          }),
        ]);
        const memberLoadErrors: string[] = [];

        if (statsResult.status === 'fulfilled') {
          setMemberStats(statsResult.value.stats);
        } else {
          memberLoadErrors.push(
            statsResult.reason instanceof Error
              ? statsResult.reason.message
              : 'Unable to load workspace stats.',
          );
        }

        if (reposResult.status === 'fulfilled') {
          setMemberRepos(reposResult.value.repos);
        } else {
          memberLoadErrors.push(
            reposResult.reason instanceof Error
              ? reposResult.reason.message
              : 'Unable to load workspace repositories.',
          );
        }

        if (memberLoadErrors.length) {
          setError(memberLoadErrors[0]);
        }
        setIsLoading(false);
        return;
      } catch (memberError) {
        if (memberError instanceof ApiRequestError) {
          const canFallbackToPublic = [401, 403, 404].includes(memberError.status);
          if (!canFallbackToPublic && isAuthenticated) {
            setError(memberError.message);
            setResolvedView('member');
            setIsLoading(false);
            return;
          }
        } else if (isAuthenticated) {
          setError(
            memberError instanceof Error
              ? memberError.message
              : 'Unable to load workspace overview.',
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
      } catch (err) {
        if (isAuthenticated && err instanceof ApiRequestError && err.status === 403) {
          setForbidden(true);
          setResolvedView('member');
        } else if (err instanceof ApiRequestError && [401, 403, 404].includes(err.status)) {
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load workspace overview.');
        }
        if (!isAuthenticated || !(err instanceof ApiRequestError && err.status === 403)) {
          setResolvedView('public');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [workspaceId]);

  if (!isHydrated) {
    return null;
  }

  if (forbidden) {
    return (
      <AppShell>
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
        <PortalPage className="inbox-shell workspace-overview-shell">
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

  if (hasToken && resolvedView === null) {
    return (
      <AppShell>
        <PortalPage className="inbox-shell workspace-overview-shell">
          <PortalCardSkeleton lines={4} />
          <PortalCardSkeleton lines={5} />
        </PortalPage>
      </AppShell>
    );
  }

  if (showPublicShell) {
    return (
      <PublicShell mode="landing">
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
        <section className="inbox-shell workspace-public-shell">
          {isLoading ? (
            <p className="muted inbox-state">Loading workspace...</p>
          ) : workspace ? (
            <Card className="canvas-card workspace-public-card stack">
              <div className="workspace-public-head">
                <p className="muted">Workspace</p>
                <h1>{workspace.name}</h1>
                <p className="muted">@{workspace.slug}</p>
                {workspace.description && publicData?.visibility.canViewDescription ? (
                  <p className="workspace-public-description">{workspace.description}</p>
                ) : null}
                {workspace.website && publicData?.visibility.canViewWebsite ? (
                  <Button href={workspace.website} target="_blank" rel="noreferrer" variant="secondary">
                    Visit website
                  </Button>
                ) : null}
              </div>

              {publicData?.visibility.canViewRepos ? (
                <>
                  <div className="workspace-public-metrics">
                    <article>
                      <span>Public repos</span>
                      <strong>{publicData?.stats.publicRepoCount ?? 0}</strong>
                    </article>
                    <article>
                      <span>Open issues</span>
                      <strong>{publicData?.stats.openIssues ?? 0}</strong>
                    </article>
                    <article>
                      <span>Open pull requests</span>
                      <strong>{publicData?.stats.openPulls ?? 0}</strong>
                    </article>
                  </div>

                  {publicData?.repos.length ? (
                    <ul className="list workspace-public-repos">
                      {publicData.repos.map((repo) => {
                        const languageItems = (repo.languages ?? [])
                          .filter((item) => item.percent > 0)
                          .slice(0, 4);
                        return (
                          <li key={repo.id}>
                            <div className="workspace-public-repo-main">
                              <Link href={`/workspaces/${workspace.slug}/repos/${repo.slug}`}>
                                <strong>{repo.name}</strong>
                              </Link>
                              <span className="muted">
                                {repo.publicReadRequiresAuth && !hasToken
                                  ? 'Sign in required to open'
                                  : `Updated ${new Date(repo.updatedAt).toLocaleDateString()}`}
                              </span>
                              {languageItems.length ? (
                                <div
                                  className="workspace-public-repo-languages"
                                  aria-label="Language breakdown"
                                >
                                  <div
                                    className="workspace-public-repo-language-bar"
                                    aria-hidden="true"
                                  >
                                    {languageItems.map((item) => (
                                      <span
                                        key={item.language}
                                        className="workspace-public-repo-language-segment"
                                        style={{
                                          width: `${item.percent}%`,
                                          backgroundColor:
                                            item.color || 'var(--canvas-muted)',
                                        }}
                                      />
                                    ))}
                                  </div>
                                  <div className="workspace-public-repo-language-list">
                                    {languageItems.map((item) => (
                                      <span
                                        key={item.language}
                                        className="workspace-public-repo-language-item"
                                      >
                                        <span
                                          className="workspace-public-repo-language-dot"
                                          aria-hidden="true"
                                          style={{
                                            backgroundColor:
                                              item.color || 'var(--canvas-muted)',
                                          }}
                                        />
                                        <span>{item.language}</span>
                                        <span>
                                          {item.percent.toFixed(item.percent < 10 ? 1 : 0)}%
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <span
                              className={`visibility-badge ${
                                repo.publicReadRequiresAuth && !hasToken ? 'private' : 'public'
                              }`}
                            >
                              {repo.publicReadRequiresAuth && !hasToken ? 'SIGN IN' : 'PUBLIC'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="muted">No public repositories.</p>
                  )}
                </>
              ) : (
                <p className="muted">
                  This workspace hides public overview details.
                </p>
              )}
            </Card>
          ) : (
            <PortalList>
              <PortalEmptyState message="Workspace not found or inaccessible." />
            </PortalList>
          )}
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

      <PortalPage className="inbox-shell workspace-overview-shell">
        {isLoading ? (
          <>
            <PortalCardSkeleton lines={4} />
            <PortalCardSkeleton lines={5} />
          </>
        ) : workspace ? (
          <>
            <section className="card canvas-card workspace-summary-card workspace-summary-card-compact">
              <SectionHeader
                className="workspace-summary-head"
                title={workspace.name}
                subtitle={workspace.description?.trim() || 'No workspace description yet.'}
              />

              <div className="workspace-summary-grid">
                <div className="workspace-summary-item">
                  <span>Role</span>
                  <strong>{workspace.viewerRole ?? 'MEMBER'}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Repositories</span>
                  <strong>{memberStats?.repoCount ?? 0}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Open issues</span>
                  <strong>{memberStats?.openIssues ?? 0}</strong>
                </div>
                <div className="workspace-summary-item">
                  <span>Open pull requests</span>
                  <strong>{memberStats?.openPulls ?? 0}</strong>
                </div>
              </div>
            </section>

            <section className="card canvas-card workspace-overview-repos-card">
              <div className="workspace-overview-repos-head">
                <div className="workspace-summary-identity">
                  <h3>Repositories</h3>
                  <p className="muted">
                    {repoQuery
                      ? `Showing ${filteredMemberRepos.length} of ${memberRepos.length} repositories`
                      : `${memberRepos.length} repositories in this workspace`}
                  </p>
                </div>
                <div className="workspace-overview-repos-actions" />
              </div>

              {shouldShowRepoList ? (
                filteredMemberRepos.length ? (
                  <ul className="list workspace-overview-repo-list">
                    {filteredMemberRepos.map((repo) => (
                      <RepoListRow
                        key={repo.id}
                        className="workspace-overview-repo-row"
                        name={repo.name}
                        defaultBranch={repo.defaultBranch}
                        visibility={repo.visibility}
                        languages={repo.languages}
                        href={`/workspaces/${workspaceRef}/repos/${repo.slug}`}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No repositories match your search.</p>
                )
              ) : null}
            </section>
          </>
        ) : (
          <PortalList>
            <PortalEmptyState message="Workspace not found or inaccessible." />
          </PortalList>
        )}
      </PortalPage>
    </AppShell>
  );
}

