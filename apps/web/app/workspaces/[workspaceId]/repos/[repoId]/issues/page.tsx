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
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  publicReadRequiresAuth?: boolean;
  workspace?: {
    slug?: string;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

type Issue = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
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

const statusOptions = ['OPEN', 'CLOSED', 'ALL'] as const;
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

export default function RepoIssuesPage() {
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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);
  const [createIssueTitle, setCreateIssueTitle] = useState('');
  const [createIssueBody, setCreateIssueBody] = useState('');

  useEffect(() => {
    if (!workspaceId || !repoId) {
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setAuthRequired(false);
      setForbidden(false);
      setCommentCounts({});
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
          ? `/workspaces/${workspaceId}/repos/${repoId}/issues?${query.toString()}`
          : `/workspaces/${workspaceId}/repos/${repoId}/issues`;
        const issueData = await apiFetch<{ issues: Issue[] }>(listPath, {
          suppressAuthRedirect: true,
        });
        setIssues(issueData.issues);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to read issues in this repository.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have permission to read this repository.');
          } else if (err.status === 404) {
            setError('Repository not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load issues.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [repoId, statusFilter, workspaceId]);

  useEffect(() => {
    if (!issues.length) {
      setCommentCounts({});
      return;
    }

    let cancelled = false;
    const loadComments = async () => {
      const topIssues = issues.slice(0, 20);
      const counts = await Promise.all(
        topIssues.map(async (issue) => {
          try {
            const data = await apiFetch<{ comments: Array<{ id: string }> }>(
              `/workspaces/${workspaceId}/repos/${repoId}/issues/${issue.id}/comments`,
              { suppressAuthRedirect: true },
            );
            return [issue.id, data.comments.length] as const;
          } catch {
            return [issue.id, 0] as const;
          }
        }),
      );
      if (!cancelled) {
        setCommentCounts(Object.fromEntries(counts));
      }
    };

    void loadComments();
    return () => {
      cancelled = true;
    };
  }, [issues, repoId, workspaceId]);

  const filteredIssues = useMemo(() => {
    const normalized = queryParam.toLowerCase();
    if (!normalized) {
      return issues;
    }
    return issues.filter((issue) => {
      const labels = issue.labels.map((label) => label.name.toLowerCase()).join(' ');
      const assignees = issue.assignees
        .map((assignee) => userLabel(assignee).toLowerCase())
        .join(' ');
      return (
        issue.title.toLowerCase().includes(normalized) ||
        userLabel(issue.author).toLowerCase().includes(normalized) ||
        labels.includes(normalized) ||
        assignees.includes(normalized)
      );
    });
  }, [issues, queryParam]);

  const canWrite = repo?.viewerRole === 'WRITE' || repo?.viewerRole === 'ADMIN';
  const issueActionLabel = 'View';
  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;

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
        ? `/workspaces/${workspaceId}/repos/${repoId}/issues?${query}`
        : `/workspaces/${workspaceId}/repos/${repoId}/issues`,
    );
  };

  const createIssue = async () => {
    const title = createIssueTitle.trim();
    if (!title) {
      setError('Issue title is required.');
      return;
    }
    if (title.length < 2) {
      setError('Issue title must be at least 2 characters.');
      return;
    }

    setIsCreatingIssue(true);
    setError(null);
    try {
      const data = await apiFetch<{ issue: Issue }>(
        `/workspaces/${workspaceId}/repos/${repoId}/issues`,
        {
          method: 'POST',
          body: JSON.stringify({
            title,
            body: createIssueBody.trim() || undefined,
          }),
          suppressAuthRedirect: true,
        },
      );
      setIssues((current) => [data.issue, ...current]);
      setCreateIssueTitle('');
      setCreateIssueBody('');
      setIsCreateOpen(false);
      setStatusMessage('Issue created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create issue.');
    } finally {
      setIsCreatingIssue(false);
    }
  };

  return (
    <AppShell title="Issues">
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
      <PortalPage className="repo-issues-shell">
        <RepoNav
          workspaceId={repoWorkspaceRef}
          repoId={repoRef}
          active="issues"
          viewerRole={repo?.viewerRole}
        />

        <PortalToolbar
          title="Issues"
          subtitle="Track bugs, requests, and follow-up work for this repository."
          actions={
            <>
              {statusOptions.map((option) => (
                <button
                  key={option}
                  className={`inbox-action ${statusFilter === option ? 'active' : ''}`}
                  type="button"
                  onClick={() => updateSearchParam('status', option)}
                >
                  {option === 'ALL' ? 'All' : option === 'OPEN' ? 'Open' : 'Closed'}
                </button>
              ))}
              {canWrite ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsCreateOpen(true)}
                >
                  New issue
                </Button>
              ) : getToken() ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  href={`/login?from=${encodeURIComponent(`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues`)}`}
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
              <PortalCardSkeleton key={`issues-skeleton-${index}`} lines={3} />
            ))}
          </div>
        ) : authRequired ? (
          <Card className="stack">
            <p className="muted">
              This repository requires authentication before you can read issues.
            </p>
            <InlineFormRow align="start">
              <Button
                variant="primary"
                size="sm"
                href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceId}/repos/${repoId}/issues`)}`}
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
            {filteredIssues.length ? (
              <ul className="list">
                {filteredIssues.map((issue) => (
                  <li key={issue.id} className="queue-item repo-issue-row repo-listing-row">
                    <div className="repo-issue-main">
                      <div className="repo-issue-title-row">
                        <span
                          className={`portal-pill ${
                            issue.status === 'OPEN' ? 'portal-pill--write' : 'portal-pill--member'
                          }`}
                        >
                          {issue.status}
                        </span>
                        <Link
                          className="repo-detail-link"
                          href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues/${issue.id}`}
                        >
                          <strong className="repo-listing-title">{issue.title}</strong>
                        </Link>
                      </div>
                      <p className="muted repo-issue-meta">
                        Opened {formatRelative(issue.createdAt)} by {userLabel(issue.author)}
                      </p>
                      <div className="repo-issue-badges">
                        {issue.labels.map((label) => (
                          <span
                            key={label.id}
                            className="repo-inline-chip"
                            style={{ borderColor: `${label.color}66`, backgroundColor: `${label.color}1f` }}
                          >
                            {label.name}
                          </span>
                        ))}
                        {issue.assignees.map((assignee) => (
                          <span key={assignee.id} className="repo-inline-chip repo-inline-chip-muted">
                            {userLabel(assignee)}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="repo-issue-side">
                      <span className="muted repo-listing-count">
                        {commentCounts[issue.id] ?? 0} comment{(commentCounts[issue.id] ?? 0) === 1 ? '' : 's'}
                      </span>
                      <Button
                        variant={canWrite ? 'secondary' : 'primary'}
                        size="sm"
                        href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues/${issue.id}`}
                      >
                        {issueActionLabel}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title={queryParam ? 'No issues match your search.' : 'No issues found for this filter.'}
                description="Try a different status filter or search query."
              />
            )}
          </PortalList>
        )}

        <Modal
          open={isCreateOpen}
          onClose={() => {
            if (!isCreatingIssue) {
              setIsCreateOpen(false);
            }
          }}
          title="New issue"
          subtitle="Create an issue for this repository."
          footer={(
            <InlineFormRow align="start">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isCreatingIssue}
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={isCreatingIssue}
                onClick={() => {
                  void createIssue();
                }}
              >
                {isCreatingIssue ? 'Creating...' : 'Create issue'}
              </Button>
            </InlineFormRow>
          )}
        >
          <label className="field">
            Title
            <input
              value={createIssueTitle}
              onChange={(event) => setCreateIssueTitle(event.target.value)}
              placeholder="Describe the issue"
            />
          </label>
          <label className="field">
            Description
            <textarea
              rows={6}
              value={createIssueBody}
              onChange={(event) => setCreateIssueBody(event.target.value)}
              placeholder="Provide context, expected behavior, and reproduction steps"
            />
          </label>
        </Modal>
      </PortalPage>
    </AppShell>
  );
}
