'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppShell } from '../../components/AppShell';
import { apiFetch } from '../../lib/api';
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from '../../lib/workspace';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  PortalList,
  PortalPage,
  PortalRow,
  PortalToolbar,
} from '../../components/portal';
import { Button, EmptyState, InlineFormRow } from '../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
};

type Repo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

type PullRequest = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  author: {
    name?: string | null;
    email: string;
    username?: string | null;
  };
  assignees: Array<{
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  }>;
  labels: Array<{
    id: string;
    name: string;
    color: string;
  }>;
};

type PullItem = PullRequest & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  repoId: string;
  repoName: string;
  repoSlug: string;
};

export default function PullsHubPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [pulls, setPulls] = useState<PullItem[]>([]);
  const [viewerIdentity, setViewerIdentity] = useState<{
    id: string;
    email?: string | null;
    username?: string | null;
  } | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'CLOSED' | 'MERGED' | 'ALL'>(
    'OPEN',
  );
  const [assigneeScope, setAssigneeScope] = useState<'ALL' | 'MINE'>('ALL');
  const [reviewScope, setReviewScope] = useState<'ALL' | 'NEEDS_REVIEW'>('ALL');
  const queryParam = searchParams.get('q') ?? '';
  const statusParam = searchParams.get('status');
  const assigneeParam = searchParams.get('assignee');
  const labelParam = searchParams.get('label') ?? '';
  const statusFromQuery =
    statusParam === 'OPEN' ||
    statusParam === 'CLOSED' ||
    statusParam === 'MERGED' ||
    statusParam === 'ALL'
      ? statusParam
      : null;
  const assigneeFromQuery = assigneeParam === 'me' ? 'MINE' : 'ALL';
  const [query, setQuery] = useState(queryParam);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const [reviewRequestsByPullId, setReviewRequestsByPullId] = useState<
    Record<string, string[]>
  >({});

  const reviewParam = searchParams.get('review');

  useEffect(() => {
    const needsReview = reviewParam === 'needed';
    setReviewScope(needsReview ? 'NEEDS_REVIEW' : 'ALL');
    if (needsReview && statusFilter !== 'OPEN') {
      setStatusFilter('OPEN');
    }
  }, [reviewParam, statusFilter]);

  useEffect(() => {
    setQuery(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (statusFromQuery && statusFromQuery !== statusFilter) {
      setStatusFilter(statusFromQuery);
    }
  }, [statusFromQuery, statusFilter]);

  useEffect(() => {
    if (assigneeFromQuery !== assigneeScope) {
      setAssigneeScope(assigneeFromQuery);
    }
  }, [assigneeFromQuery, assigneeScope]);

  const updateSearchParam = (
    key: string,
    value: string,
    options?: { keepAll?: boolean },
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || (!options?.keepAll && value === 'ALL')) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    const queryString = params.toString();
    router.replace(queryString ? `/pulls?${queryString}` : '/pulls');
  };

  const activeFilterCount =
    (statusFilter !== 'OPEN' ? 1 : 0) +
    (assigneeScope === 'MINE' ? 1 : 0) +
    (reviewScope === 'NEEDS_REVIEW' ? 1 : 0) +
    (labelParam.trim() ? 1 : 0);

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('status', 'OPEN');
    params.delete('assignee');
    params.delete('review');
    params.delete('label');
    const queryString = params.toString();
    router.replace(queryString ? `/pulls?${queryString}` : '/pulls');
  };

  const updateReviewParam = (nextScope: 'ALL' | 'NEEDS_REVIEW') => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextScope === 'NEEDS_REVIEW') {
      params.set('review', 'needed');
    } else {
      params.delete('review');
    }
    const queryString = params.toString();
    router.replace(queryString ? `/pulls?${queryString}` : '/pulls');
  };

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        try {
          const meData = await apiFetch<{
            user: { id: string; email?: string | null; username?: string | null };
          }>('/me');
          setViewerIdentity(meData.user);
        } catch {
          setViewerIdentity(null);
        }

        const workspaceData = await apiFetch<{ workspaces: Workspace[] }>('/workspaces');
        const workspaceList = workspaceData.workspaces;
        if (!workspaceList.length) {
          setActiveWorkspace(null);
          setRepos([]);
          setPulls([]);
          return;
        }
        const selectedWorkspaceId = getSelectedWorkspaceId();
        const nextActiveWorkspace =
          (selectedWorkspaceId
            ? workspaceList.find((workspace) => workspace.id === selectedWorkspaceId)
            : null) ??
          workspaceList.find((workspace) => workspace.isPersonal) ??
          workspaceList[0];
        if (nextActiveWorkspace) {
          setSelectedWorkspaceId(nextActiveWorkspace.id);
          setActiveWorkspace(nextActiveWorkspace);
        }
        const scopedWorkspaces = nextActiveWorkspace ? [nextActiveWorkspace] : workspaceList;

        const repoResults = await Promise.all(
          scopedWorkspaces.map((workspace) =>
            apiFetch<{
              repos: {
                id: string;
                name: string;
                slug: string;
                visibility: Repo['visibility'];
              }[];
            }>(`/workspaces/${workspace.id}/repos`).then((data) => ({
              workspace,
              repos: data.repos,
            })),
          ),
        );

        const repoEntries = repoResults.flatMap((entry) =>
          entry.repos.map((repo) => ({
            id: repo.id,
            name: repo.name,
            slug: repo.slug,
            visibility: repo.visibility,
            workspaceId: entry.workspace.id,
            workspaceName: entry.workspace.name,
            workspaceSlug: entry.workspace.slug,
          })),
        );
        setRepos(repoEntries);

        const pullResults = await Promise.allSettled(
          repoEntries.map(async (repo) => {
            const data = await apiFetch<{ pulls: PullRequest[] }>(
              `/workspaces/${repo.workspaceId}/repos/${repo.id}/pulls${
                statusFilter === 'ALL' ? '' : `?status=${statusFilter}`
              }`,
            );
            return data.pulls.map((pull) => ({
              ...pull,
              workspaceId: repo.workspaceId,
              workspaceName: repo.workspaceName,
              workspaceSlug: repo.workspaceSlug,
              repoId: repo.id,
              repoName: repo.name,
              repoSlug: repo.slug,
            }));
          }),
        );

        const resolvedPulls = pullResults.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        );
        setPulls(resolvedPulls);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load pull requests.');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [statusFilter]);

  useEffect(() => {
    const viewerId = viewerIdentity?.id ?? null;
    if (reviewScope !== 'NEEDS_REVIEW' || !viewerId || pulls.length === 0) {
      setReviewRequestsByPullId({});
      setIsLoadingReviews(false);
      return;
    }

    let cancelled = false;
    const loadReviewRequests = async () => {
      setIsLoadingReviews(true);
      try {
        const results = await Promise.allSettled(
          pulls.map((pull) =>
            apiFetch<{
              reviewRequests: Array<{ reviewer: { id: string } }>;
            }>(`/workspaces/${pull.workspaceId}/repos/${pull.repoId}/pulls/${pull.id}/review-requests`),
          ),
        );
        if (cancelled) {
          return;
        }
        const map: Record<string, string[]> = {};
        results.forEach((result, index) => {
          const pull = pulls[index];
          if (!pull) {
            return;
          }
          if (result.status === 'fulfilled') {
            map[pull.id] = result.value.reviewRequests.map((entry) => entry.reviewer.id);
          } else {
            map[pull.id] = [];
          }
        });
        setReviewRequestsByPullId(map);
      } finally {
        if (!cancelled) {
          setIsLoadingReviews(false);
        }
      }
    };

    void loadReviewRequests();
    return () => {
      cancelled = true;
    };
  }, [pulls, reviewScope, viewerIdentity]);

  const filteredPulls = useMemo(() => {
    const search = query.trim().toLowerCase();
    const labelFilter = labelParam.trim().toLowerCase();
    const viewerId = viewerIdentity?.id ?? null;
    const viewerEmail = viewerIdentity?.email?.toLowerCase() ?? null;
    const viewerUsername = viewerIdentity?.username?.toLowerCase() ?? null;
    return pulls.filter((pull) => {
      if (
        assigneeScope === 'MINE' &&
        (!viewerId ||
          !pull.assignees.some((assignee) => {
            const assigneeEmail = assignee.email?.toLowerCase() ?? '';
            const assigneeUsername = assignee.username?.toLowerCase() ?? '';
            return (
              assignee.id === viewerId ||
              (viewerEmail ? assigneeEmail === viewerEmail : false) ||
              (viewerUsername ? assigneeUsername === viewerUsername : false)
            );
          }))
      ) {
        return false;
      }
      if (
        labelFilter &&
        !pull.labels.some((label) => label.name.toLowerCase().includes(labelFilter))
      ) {
        return false;
      }
      if (reviewScope === 'NEEDS_REVIEW') {
        if (!viewerId) {
          return false;
        }
        const reviewers = reviewRequestsByPullId[pull.id] ?? [];
        if (!reviewers.includes(viewerId)) {
          return false;
        }
      }
      if (!search) {
        return true;
      }
      const author = (pull.author.name ?? pull.author.email).toLowerCase();
      const assigneeMatch = pull.assignees.some((assignee) =>
        (assignee.name ?? assignee.username ?? assignee.email)
          .toLowerCase()
          .includes(search),
      );
      const labelMatch = pull.labels.some((label) =>
        label.name.toLowerCase().includes(search),
      );
      return (
        pull.title.toLowerCase().includes(search) ||
        author.includes(search) ||
        assigneeMatch ||
        labelMatch ||
        pull.sourceBranch.toLowerCase().includes(search) ||
        pull.targetBranch.toLowerCase().includes(search) ||
        pull.repoName.toLowerCase().includes(search) ||
        pull.workspaceName.toLowerCase().includes(search)
      );
    });
  }, [
    assigneeScope,
    labelParam,
    pulls,
    query,
    reviewRequestsByPullId,
    reviewScope,
    viewerIdentity,
  ]);

  const hasRepos = repos.length > 0;

  return (
    <AppShell title="Pull requests">
      <PortalPage className="triage-shell">
        {!activeWorkspace && !isLoading ? (
          <>
            <PortalToolbar
              title="Pull request inbox"
              subtitle="Select a workspace from the sidebar to see pull requests."
            />
            <PortalList>
              <EmptyState title="No workspace selected." />
              <InlineFormRow className="portal-empty-actions">
                <Button variant="primary" href="/workspaces">
                  Go to workspaces
                </Button>
              </InlineFormRow>
            </PortalList>
          </>
        ) : !hasRepos && !isLoading ? (
          <>
            <PortalToolbar
              title="Pull request inbox"
              subtitle="Create or join a workspace to see pull requests."
            />
            <PortalList>
              <EmptyState title="No repositories found in this workspace." />
              <InlineFormRow className="portal-empty-actions">
                <Button variant="primary" href="/workspaces">
                  Go to workspaces
                </Button>
                <Button variant="ghost" href="/repositories">
                  Browse repositories
                </Button>
              </InlineFormRow>
            </PortalList>
          </>
        ) : (
          <>
            <PortalToolbar
              title="Pull request inbox"
              subtitle="Review, track, and close active work."
              actions={
                <>
                  <button
                    className={`inbox-action ${assigneeScope === 'MINE' ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      const next = assigneeScope === 'MINE' ? 'ALL' : 'MINE';
                      setAssigneeScope(next);
                      updateSearchParam('assignee', next === 'MINE' ? 'me' : '');
                    }}
                    disabled={!viewerIdentity?.id}
                  >
                    Assigned to me
                  </button>
                  {activeFilterCount ? (
                    <button className="inbox-action" type="button" onClick={clearFilters}>
                      Clear filters ({activeFilterCount})
                    </button>
                  ) : null}
                </>
              }
            >
              <div className="inbox-toolbar-row">
                <div className="row filter-row triage-filter-strip">
                  {(['OPEN', 'MERGED', 'CLOSED', 'ALL'] as const).map((value) => (
                    <button
                      key={value}
                      className={`filter-chip ${statusFilter === value ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        updateSearchParam('status', value, { keepAll: true });
                        if (reviewScope !== 'ALL' && value !== 'OPEN') {
                          updateReviewParam('ALL');
                        }
                      }}
                    >
                      {value === 'ALL' ? 'All' : value}
                    </button>
                  ))}
                  <button
                    className={`filter-chip ${reviewScope === 'NEEDS_REVIEW' ? 'active' : ''}`}
                    type="button"
                    onClick={() => {
                      const next = reviewScope === 'NEEDS_REVIEW' ? 'ALL' : 'NEEDS_REVIEW';
                      setReviewScope(next);
                      updateReviewParam(next);
                      if (next === 'NEEDS_REVIEW' && statusFilter !== 'OPEN') {
                        updateSearchParam('status', 'OPEN', { keepAll: true });
                      }
                    }}
                    disabled={!viewerIdentity?.id}
                  >
                    Needs review
                  </button>
                </div>
              </div>
            </PortalToolbar>

            <PortalList>
              {error ? <div className="inbox-state error">{error}</div> : null}
              {reviewScope === 'NEEDS_REVIEW' && !viewerIdentity?.id ? (
                <EmptyState
                  title="Sign in to see pull requests needing your review."
                  description="Switch to all pull requests or sign in to continue."
                />
              ) : isLoading || (reviewScope === 'NEEDS_REVIEW' && isLoadingReviews) ? (
                <div className="inbox-state muted">Loading pull requests...</div>
              ) : filteredPulls.length ? (
                <ul className="list triage-list">
                  {filteredPulls.map((pull) => (
                    <PortalRow key={`${pull.repoId}-${pull.id}`} className="triage-card-row">
                      <div className="triage-card">
                        <div className="triage-card-head">
                          <div className="triage-card-title-wrap">
                            <span className={`triage-status triage-status--${pull.status.toLowerCase()}`}>
                              {pull.status}
                            </span>
                            <strong className="triage-card-title">{pull.title}</strong>
                          </div>
                        </div>
                        <p className="muted triage-card-meta">
                          {pull.workspaceName} / {pull.repoName}
                          <span aria-hidden="true"> | </span>
                          {new Date(pull.createdAt).toLocaleDateString()}
                        </p>
                        <p className="muted triage-card-branch">
                          {pull.sourceBranch} -&gt; {pull.targetBranch}
                        </p>
                        <p className="muted triage-card-assignees">
                          {pull.assignees.length
                            ? `Assignees: ${pull.assignees
                                .map((assignee) => assignee.name ?? assignee.username ?? assignee.email)
                                .join(', ')}`
                            : 'Unassigned'}
                        </p>
                        {pull.labels.length ? (
                          <div className="row triage-card-labels">
                            {pull.labels.map((label) => (
                              <span
                                key={label.id}
                                className="chip"
                                style={{
                                  borderColor: label.color,
                                  backgroundColor: `${label.color}22`,
                                }}
                              >
                                {label.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="triage-card-foot">
                          <Button
                            variant="primary"
                            size="sm"
                            className="triage-view-button"
                            href={`/workspaces/${pull.workspaceSlug}/repos/${pull.repoSlug}/pulls/${pull.id}`}
                          >
                            View
                          </Button>
                        </div>
                      </div>
                    </PortalRow>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="No pull requests match this filter."
                  description="Try a different status filter or search query."
                />
              )}
            </PortalList>
          </>
        )}
      </PortalPage>
    </AppShell>
  );
}

