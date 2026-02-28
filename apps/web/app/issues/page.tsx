'use client';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { apiFetch } from '../../lib/api';
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from '../../lib/workspace';
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

type Issue = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
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

type IssueItem = Issue & {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  repoId: string;
  repoName: string;
  repoSlug: string;
};

export default function IssuesHubPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryParam = searchParams.get('q') ?? '';
  const statusParam = searchParams.get('status');
  const assigneeParam = searchParams.get('assignee');
  const labelParam = searchParams.get('label') ?? '';
  const statusFromQuery =
    statusParam === 'OPEN' || statusParam === 'CLOSED' || statusParam === 'ALL'
      ? statusParam
      : null;
  const assigneeFromQuery = assigneeParam === 'me' ? 'MINE' : 'ALL';
  const [repos, setRepos] = useState<Repo[]>([]);
  const [issues, setIssues] = useState<IssueItem[]>([]);
  const [viewerIdentity, setViewerIdentity] = useState<{
    id: string;
    email?: string | null;
    username?: string | null;
  } | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>(
    'OPEN',
  );
  const [assigneeScope, setAssigneeScope] = useState<'ALL' | 'MINE'>('ALL');
  const [query, setQuery] = useState(queryParam);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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

        const workspaceData = await apiFetch<{ workspaces?: Workspace[] }>('/workspaces');
        const workspaceList = workspaceData.workspaces ?? [];
        if (!workspaceList.length) {
          setActiveWorkspace(null);
          setRepos([]);
          setIssues([]);
          return;
        }
        const selectedWorkspaceId = getSelectedWorkspaceId();
        const nextActiveWorkspace =
          (selectedWorkspaceId
            ? workspaceList.find(
                (workspace) =>
                  workspace.id === selectedWorkspaceId ||
                  workspace.slug === selectedWorkspaceId,
              )
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

        const issueResults = await Promise.allSettled(
          repoEntries.map(async (repo) => {
            const data = await apiFetch<{ issues: Issue[] }>(
              `/workspaces/${repo.workspaceId}/repos/${repo.id}/issues${
                statusFilter === 'ALL' ? '' : `?status=${statusFilter}`
              }`,
            );
            return data.issues.map((issue) => ({
              ...issue,
              workspaceId: repo.workspaceId,
              workspaceName: repo.workspaceName,
              workspaceSlug: repo.workspaceSlug,
              repoId: repo.id,
              repoName: repo.name,
              repoSlug: repo.slug,
            }));
          }),
        );

        const resolvedIssues = issueResults.flatMap((result) =>
          result.status === 'fulfilled' ? result.value : [],
        );
        setIssues(resolvedIssues);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load issues.');
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [statusFilter]);

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

  const activeFilterCount =
    (statusFilter !== 'OPEN' ? 1 : 0) +
    (assigneeScope === 'MINE' ? 1 : 0) +
    (labelParam.trim() ? 1 : 0);

  const clearFilters = () => {
    updateSearchParam('status', 'OPEN', { keepAll: true });
    updateSearchParam('assignee', '');
    updateSearchParam('label', '');
  };

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
    router.replace(queryString ? `/issues?${queryString}` : '/issues');
  };

  const filteredIssues = useMemo(() => {
    const search = query.trim().toLowerCase();
    const labelFilter = labelParam.trim().toLowerCase();
    const viewerId = viewerIdentity?.id ?? null;
    const viewerEmail = viewerIdentity?.email?.toLowerCase() ?? null;
    const viewerUsername = viewerIdentity?.username?.toLowerCase() ?? null;
    return issues.filter((issue) => {
      if (
        assigneeScope === 'MINE' &&
        (!viewerId ||
          !issue.assignees.some((assignee) => {
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
        !issue.labels.some((label) => label.name.toLowerCase().includes(labelFilter))
      ) {
        return false;
      }
      if (!search) {
        return true;
      }
      const author = (issue.author.name ?? issue.author.email).toLowerCase();
      const assigneeMatch = issue.assignees.some((assignee) =>
        (assignee.name ?? assignee.username ?? assignee.email)
          .toLowerCase()
          .includes(search),
      );
      const labelMatch = issue.labels.some((label) =>
        label.name.toLowerCase().includes(search),
      );
      return (
        issue.title.toLowerCase().includes(search) ||
        author.includes(search) ||
        assigneeMatch ||
        labelMatch ||
        issue.repoName.toLowerCase().includes(search) ||
        issue.workspaceName.toLowerCase().includes(search)
      );
    });
  }, [assigneeScope, issues, labelParam, query, viewerIdentity]);

  const hasRepos = repos.length > 0;

  return (
    <AppShell title="Issues">
      <PortalPage className="triage-shell">
        {!activeWorkspace && !isLoading ? (
          <>
            <PortalToolbar
              title="Issue inbox"
              subtitle="Select a workspace from the sidebar to see issues."
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
              title="Issue inbox"
              subtitle="Create or join a workspace to see issues."
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
              title="Issue inbox"
              subtitle="Track open issues across the active workspace."
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
                  {(['OPEN', 'CLOSED', 'ALL'] as const).map((value) => (
                    <button
                      key={value}
                      className={`filter-chip ${statusFilter === value ? 'active' : ''}`}
                      type="button"
                      onClick={() => {
                        updateSearchParam('status', value, { keepAll: true });
                      }}
                    >
                      {value === 'ALL' ? 'All' : value}
                    </button>
                  ))}
                </div>
              </div>
            </PortalToolbar>

            <PortalList>
              {error ? <div className="inbox-state error">{error}</div> : null}
              {isLoading ? (
                <div className="inbox-state muted">Loading issues...</div>
              ) : filteredIssues.length ? (
                <ul className="list triage-list">
                  {filteredIssues.map((issue) => (
                    <PortalRow key={`${issue.repoId}-${issue.id}`} className="triage-card-row">
                      <div className="triage-card">
                        <div className="triage-card-head">
                          <div className="triage-card-title-wrap">
                            <span className={`triage-status triage-status--${issue.status.toLowerCase()}`}>
                              {issue.status}
                            </span>
                            <strong className="triage-card-title">{issue.title}</strong>
                          </div>
                        </div>
                        <p className="muted triage-card-meta">
                          {issue.workspaceName} / {issue.repoName}
                          <span aria-hidden="true"> | </span>
                          {new Date(issue.createdAt).toLocaleDateString()}
                        </p>
                        <p className="muted triage-card-assignees">
                          {issue.assignees.length
                            ? `Assignees: ${issue.assignees
                                .map((assignee) => assignee.name ?? assignee.username ?? assignee.email)
                                .join(', ')}`
                            : 'Unassigned'}
                        </p>
                        {issue.labels.length ? (
                          <div className="row triage-card-labels">
                            {issue.labels.map((label) => (
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
                            href={`/workspaces/${issue.workspaceSlug}/repos/${issue.repoSlug}/issues/${issue.id}`}
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
                  title="No issues match this filter."
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

