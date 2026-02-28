'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../../../components/AppShell';
import { RepoHeader } from '../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../components/RepoNav';
import {
  PortalCardSkeleton,
  PortalList,
  PortalPage,
  PortalToolbar,
} from '../../../../../../components/portal';
import { PortalToast } from '../../../../../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../../../../../lib/api';
import { getToken } from '../../../../../../lib/auth';
import { Button, Card, EmptyState, InlineFormRow, Modal } from '../../../../../../src/components/ui';

type Repo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  publicReadRequiresAuth?: boolean;
  workspace?: {
    id?: string;
    slug?: string;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

type Pull = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  author: {
    id: string;
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

type PullCheck = {
  id: string;
  context: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE';
  updatedAt: string;
};

type Branch = {
  name: string;
  sha: string;
};

const statusOptions = ['OPEN', 'CLOSED', 'MERGED', 'ALL'] as const;
type StatusFilter = (typeof statusOptions)[number];

function formatRelative(value: string) {
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / (1000 * 60)));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(value).toLocaleDateString();
}

function userLabel(user: { name?: string | null; username?: string | null; email: string }) {
  return user.name || user.username || user.email;
}

export default function RepoPullsPage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const statusParam = searchParams.get('status');
  const queryParam = (searchParams.get('q') ?? '').trim();
  const statusFilter: StatusFilter = statusOptions.includes(statusParam as StatusFilter)
    ? (statusParam as StatusFilter)
    : 'OPEN';

  const [repo, setRepo] = useState<Repo | null>(null);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [pullChecks, setPullChecks] = useState<Record<string, PullCheck[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreatingPull, setIsCreatingPull] = useState(false);
  const [createPullTitle, setCreatePullTitle] = useState('');
  const [createPullBody, setCreatePullBody] = useState('');
  const [createPullSourceBranch, setCreatePullSourceBranch] = useState('');
  const [createPullTargetBranch, setCreatePullTargetBranch] = useState('');

  useEffect(() => {
    if (!workspaceId || !repoId) {
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setAuthRequired(false);
      setForbidden(false);
      setPullChecks({});
      setBranches([]);
      try {
        const repoData = await apiFetch<{ repo: Repo }>(
          `/workspaces/${workspaceId}/repos/${repoId}`,
          { suppressAuthRedirect: true },
        );
        setRepo(repoData.repo);

        const query = new URLSearchParams();
        if (statusFilter !== 'ALL') {
          query.set('status', statusFilter);
        }
        const listPath = query.toString()
          ? `/workspaces/${workspaceId}/repos/${repoId}/pulls?${query.toString()}`
          : `/workspaces/${workspaceId}/repos/${repoId}/pulls`;
        const pullData = await apiFetch<{ pulls: Pull[] }>(listPath, {
          suppressAuthRedirect: true,
        });
        setPulls(pullData.pulls);
        try {
          const branchData = await apiFetch<{ branches: Branch[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/branches`,
            { suppressAuthRedirect: true },
          );
          setBranches(branchData.branches);
        } catch {
          setBranches([]);
        }
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to read pull requests in this repository.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have permission to read this repository.');
          } else if (err.status === 404) {
            setError('Repository not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load pull requests.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [repoId, statusFilter, workspaceId]);

  useEffect(() => {
    if (!pulls.length) {
      setPullChecks({});
      return;
    }

    let cancelled = false;
    const loadChecks = async () => {
      const topPulls = pulls.slice(0, 20);
      const checks = await Promise.all(
        topPulls.map(async (pull) => {
          try {
            const data = await apiFetch<{ checks: PullCheck[] }>(
              `/workspaces/${workspaceId}/repos/${repoId}/pulls/${pull.id}/checks`,
              { suppressAuthRedirect: true },
            );
            return [pull.id, data.checks] as const;
          } catch {
            return [pull.id, [] as PullCheck[]] as const;
          }
        }),
      );
      if (!cancelled) {
        setPullChecks(Object.fromEntries(checks));
      }
    };

    void loadChecks();
    return () => {
      cancelled = true;
    };
  }, [pulls, repoId, workspaceId]);

  useEffect(() => {
    if (!repo) {
      return;
    }
    const target = repo.defaultBranch;
    if (target && target !== createPullTargetBranch) {
      setCreatePullTargetBranch(target);
    }
  }, [createPullTargetBranch, repo]);

  useEffect(() => {
    if (!branches.length || !repo) {
      return;
    }
    if (
      !createPullSourceBranch ||
      createPullSourceBranch === createPullTargetBranch
    ) {
      const fallbackSource = branches.find((entry) => entry.name !== repo.defaultBranch)?.name ?? '';
      setCreatePullSourceBranch(fallbackSource);
    }
  }, [branches, createPullSourceBranch, createPullTargetBranch, repo]);

  const canWrite = repo?.viewerRole === 'WRITE' || repo?.viewerRole === 'ADMIN';
  const pullActionLabel = 'View';
  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;

  const filteredPulls = useMemo(() => {
    const normalized = queryParam.toLowerCase();
    if (!normalized) {
      return pulls;
    }
    return pulls.filter((pull) => {
      const labels = pull.labels.map((label) => label.name.toLowerCase()).join(' ');
      const assignees = pull.assignees
        .map((assignee) => userLabel(assignee).toLowerCase())
        .join(' ');
      return (
        pull.title.toLowerCase().includes(normalized) ||
        userLabel(pull.author).toLowerCase().includes(normalized) ||
        labels.includes(normalized) ||
        assignees.includes(normalized) ||
        pull.sourceBranch.toLowerCase().includes(normalized) ||
        pull.targetBranch.toLowerCase().includes(normalized)
      );
    });
  }, [pulls, queryParam]);

  const updateSearchParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    const query = next.toString();
    router.replace(
      query
        ? `/workspaces/${workspaceId}/repos/${repoId}/pulls?${query}`
        : `/workspaces/${workspaceId}/repos/${repoId}/pulls`,
    );
  };

  const latestCheckStatus = (pullId: string) => {
    const checks = pullChecks[pullId] ?? [];
    if (!checks.length) {
      return 'No checks';
    }
    const sorted = [...checks].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    const latest = sorted[0];
    if (latest.status === 'SUCCESS') {
      return 'Checks passing';
    }
    if (latest.status === 'FAILURE') {
      return 'Checks failing';
    }
    if (latest.status === 'IN_PROGRESS') {
      return 'Checks running';
    }
    return 'Checks queued';
  };

  const createPull = async () => {
    if (!canWrite) {
      return;
    }
    const title = createPullTitle.trim();
    const sourceBranch = createPullSourceBranch.trim();
    const targetBranch = createPullTargetBranch.trim() || repo?.defaultBranch || '';

    if (!title) {
      setError('Pull request title is required.');
      return;
    }
    if (title.length < 2) {
      setError('Pull request title must be at least 2 characters.');
      return;
    }
    if (!sourceBranch || !targetBranch) {
      setError('Select both source and target branches.');
      return;
    }
    if (sourceBranch === targetBranch) {
      setError('Source and target branches must be different.');
      return;
    }

    setIsCreatingPull(true);
    setError(null);
    try {
      const data = await apiFetch<{ pull: Pull }>(
        `/workspaces/${workspaceId}/repos/${repoId}/pulls`,
        {
          method: 'POST',
          body: JSON.stringify({
            title,
            body: createPullBody.trim() || undefined,
            sourceBranch,
            targetBranch,
          }),
          suppressAuthRedirect: true,
        },
      );
      setPulls((current) => [data.pull, ...current]);
      setIsCreateOpen(false);
      setCreatePullTitle('');
      setCreatePullBody('');
      setStatusMessage('Pull request created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create pull request.');
    } finally {
      setIsCreatingPull(false);
    }
  };

  return (
    <AppShell title="Pull requests">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {statusMessage ? (
        <PortalToast message={statusMessage} tone="success" onClose={() => setStatusMessage(null)} />
      ) : null}

      <RepoHeader
        workspaceId={workspaceId}
        repoId={repoId}
        repo={repo}
        languages={repo?.languages ?? []}
      />
      <PortalPage className="repo-pulls-shell">
        <RepoNav
          workspaceId={repoWorkspaceRef}
          repoId={repoRef}
          active="pulls"
          viewerRole={repo?.viewerRole}
        />

        <PortalToolbar
          title="Pull requests"
          subtitle="Review branches, discuss changes, and merge approved work."
          actions={
            <>
              {statusOptions.map((option) => (
                <button
                  key={option}
                  className={`inbox-action ${statusFilter === option ? 'active' : ''}`}
                  type="button"
                  onClick={() => updateSearchParam('status', option)}
                >
                  {option === 'ALL' ? 'All' : option === 'OPEN' ? 'Open' : option === 'CLOSED' ? 'Closed' : 'Merged'}
                </button>
              ))}
              {canWrite ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsCreateOpen(true)}
                >
                  New pull request
                </Button>
              ) : getToken() ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/login?from=${encodeURIComponent(`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls`)}`}
                >
                  Login to contribute
                </Button>
              )}
            </>
          }
        />

        {isLoading ? (
          <div className="portal-skeleton-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <PortalCardSkeleton key={`pulls-skeleton-${index}`} lines={3} />
            ))}
          </div>
        ) : authRequired ? (
          <Card className="stack">
            <p className="muted">
              This repository requires authentication before you can read pull requests.
            </p>
            <InlineFormRow align="start">
              <Button
                variant="primary"
                size="sm"
                href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceId}/repos/${repoId}/pulls`)}`}
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
        ) : (
          <PortalList>
            {filteredPulls.length ? (
              <ul className="list">
                {filteredPulls.map((pull) => (
                  <li key={pull.id} className="queue-item repo-pull-row repo-listing-row">
                    <div className="repo-pull-main">
                      <div className="repo-pull-title-row">
                        <span
                          className={`portal-pill ${
                            pull.status === 'OPEN'
                              ? 'portal-pill--write'
                              : pull.status === 'MERGED'
                                ? 'portal-pill--owner'
                                : 'portal-pill--member'
                          }`}
                        >
                          {pull.status}
                        </span>
                        <Link
                          className="repo-detail-link"
                          href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls/${pull.id}`}
                        >
                          <strong className="repo-listing-title">{pull.title}</strong>
                        </Link>
                      </div>
                      <p className="muted repo-pull-meta">
                        {pull.sourceBranch} into {pull.targetBranch} - opened {formatRelative(pull.createdAt)} by{' '}
                        {userLabel(pull.author)}
                      </p>
                      <div className="repo-pull-badges">
                        {pull.labels.map((label) => (
                          <span
                            key={label.id}
                            className="repo-inline-chip"
                            style={{ borderColor: `${label.color}66`, backgroundColor: `${label.color}1f` }}
                          >
                            {label.name}
                          </span>
                        ))}
                        {pull.assignees.map((assignee) => (
                          <span key={assignee.id} className="repo-inline-chip repo-inline-chip-muted">
                            {userLabel(assignee)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="repo-pull-side">
                      <span className="muted repo-listing-count">{latestCheckStatus(pull.id)}</span>
                      <Button
                        variant={canWrite ? 'secondary' : 'primary'}
                        size="sm"
                        href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls/${pull.id}`}
                      >
                        {pullActionLabel}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={
                  queryParam ? 'No pull requests match your search.' : 'No pull requests found for this filter.'
                }
                description="Try a different status filter or search query."
              />
            )}
          </PortalList>
        )}

        <Modal
          open={isCreateOpen}
          onClose={() => {
            if (!isCreatingPull) {
              setIsCreateOpen(false);
            }
          }}
          title="New pull request"
          subtitle="Open a pull request from one branch into another."
          footer={(
            <InlineFormRow align="start">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isCreatingPull}
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isCreatingPull}
                onClick={() => {
                  void createPull();
                }}
              >
                {isCreatingPull ? 'Creating...' : 'Create pull request'}
              </Button>
            </InlineFormRow>
          )}
        >
          <label className="field">
            Title
            <input
              value={createPullTitle}
              onChange={(event) => setCreatePullTitle(event.target.value)}
              placeholder="Summarize your changes"
            />
          </label>
          <div className="row">
            <label className="field">
              Source branch
              <select
                value={createPullSourceBranch}
                onChange={(event) => setCreatePullSourceBranch(event.target.value)}
              >
                <option value="" disabled>
                  Select source
                </option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Target branch
              <select
                value={createPullTargetBranch}
                onChange={(event) => setCreatePullTargetBranch(event.target.value)}
              >
                <option value="" disabled>
                  Select target
                </option>
                {branches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Description
            <textarea
              rows={6}
              value={createPullBody}
              onChange={(event) => setCreatePullBody(event.target.value)}
              placeholder="Describe what changed and how to review"
            />
          </label>
        </Modal>
      </PortalPage>
    </AppShell>
  );
}
