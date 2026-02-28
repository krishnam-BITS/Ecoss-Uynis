'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../../../../components/AppShell';
import { RepoHeader } from '../../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../../components/RepoNav';
import { PortalToast } from '../../../../../../../components/PortalToast';
import {
  PortalCardSkeleton,
  PortalPage,
} from '../../../../../../../components/portal';
import {
  CommentComposer,
  DetailHeader,
  MarkdownViewer,
  SidebarCard,
  TimelineItem,
} from '../../../../../../../components/repo-detail';
import { ApiRequestError, apiFetch } from '../../../../../../../lib/api';
import { getToken } from '../../../../../../../lib/auth';
import { Button, Card, EmptyState, InlineFormRow } from '../../../../../../../src/components/ui';

type Repo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
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

type RepoIssue = {
  id: string;
  title: string;
  body?: string | null;
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

type IssueComment = {
  id: string;
  body: string;
  createdAt: string;
  author: {
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  };
};

function userLabel(user: { name?: string | null; username?: string | null; email: string }) {
  return user.name || user.username || user.email;
}

export default function IssueDetailPage() {
  const params = useParams<{
    workspaceId: string;
    repoId: string;
    issueId: string;
  }>();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;
  const issueId = params.issueId;

  const [repo, setRepo] = useState<Repo | null>(null);
  const [issue, setIssue] = useState<RepoIssue | null>(null);
  const [comments, setComments] = useState<IssueComment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [isMissing, setIsMissing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  useEffect(() => {
    const syncToken = () => setHasToken(Boolean(getToken()));
    syncToken();
    window.addEventListener('focus', syncToken);
    window.addEventListener('storage', syncToken);
    return () => {
      window.removeEventListener('focus', syncToken);
      window.removeEventListener('storage', syncToken);
    };
  }, []);

  useEffect(() => {
    if (!workspaceId || !repoId || !issueId) {
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setStatusMessage(null);
      setAuthRequired(false);
      setForbidden(false);
      setIsMissing(false);
      try {
        const repoData = await apiFetch<{ repo: Repo }>(
          `/workspaces/${workspaceId}/repos/${repoId}`,
          { suppressAuthRedirect: true },
        );
        setRepo(repoData.repo);
        const resolvedWorkspaceId = repoData.repo.workspace?.id ?? workspaceId;
        const resolvedRepoId = repoData.repo.id ?? repoId;

        const [issueResults, commentsData] = await Promise.all([
          Promise.allSettled([
            apiFetch<{ issues: RepoIssue[] }>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/issues?status=OPEN`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<{ issues: RepoIssue[] }>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/issues?status=CLOSED`,
              { suppressAuthRedirect: true },
            ),
          ]),
          apiFetch<{ comments: IssueComment[] }>(
            `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/issues/${issueId}/comments`,
            { suppressAuthRedirect: true },
          ),
        ]);

        const issuePool = issueResults.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.issues : [],
        );
        const selectedIssue = issuePool.find((entry) => entry.id === issueId) ?? null;
        if (!selectedIssue) {
          setIsMissing(true);
          setIssue(null);
          setComments([]);
          return;
        }

        setIssue(selectedIssue);
        setComments(commentsData.comments);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to view this issue.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have permission to read this repository.');
          } else if (err.status === 404) {
            setIsMissing(true);
            setError('Issue not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load issue.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [issueId, repoId, workspaceId]);

  const canWrite = repo?.viewerRole === 'WRITE' || repo?.viewerRole === 'ADMIN';
  const repoWorkspaceApiId = repo?.workspace?.id ?? workspaceId;
  const repoApiId = repo?.id ?? repoId;
  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;
  const issuePath = `/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues/${issueId}`;
  const viewerRoleLabel = repo?.viewerRole ?? 'READ';
  const visibilityLabel = repo?.visibility ?? 'PRIVATE';
  const statusTone = issue?.status === 'OPEN' ? 'open' : 'closed';

  const participants = useMemo(() => {
    if (!issue) {
      return [] as string[];
    }
    const values = new Set<string>();
    values.add(userLabel(issue.author));
    issue.assignees.forEach((assignee) => values.add(userLabel(assignee)));
    comments.forEach((comment) => values.add(userLabel(comment.author)));
    return [...values];
  }, [comments, issue]);
  const workflowModeLabel = participants.length > 1 ? 'Collaborative' : 'Personal';
  const isPersonalFlow = workflowModeLabel === 'Personal';

  const canComment = Boolean(issue) && hasToken && !authRequired && !forbidden;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatusMessage('Issue link copied.');
    } catch {
      setError('Unable to copy link.');
    }
  };

  const handleToggleStatus = async () => {
    if (!issue || !canWrite || isUpdatingStatus) {
      return;
    }
    const nextStatus = issue.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    setIsUpdatingStatus(true);
    try {
      const data = await apiFetch<{ issue: RepoIssue }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/issues/${issue.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
          suppressAuthRedirect: true,
        },
      );
      setIssue(data.issue);
      setStatusMessage(nextStatus === 'CLOSED' ? 'Issue closed.' : 'Issue reopened.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update issue status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleCommentSubmit = async () => {
    if (!issue || !commentDraft.trim() || !canComment || isSavingComment) {
      return;
    }
    setIsSavingComment(true);
    try {
      const data = await apiFetch<{ comment: IssueComment }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/issues/${issue.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: commentDraft.trim() }),
          suppressAuthRedirect: true,
        },
      );
      setComments((current) => [...current, data.comment]);
      setCommentDraft('');
      setStatusMessage('Comment added.');
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setAuthRequired(true);
        setError('Sign in is required to comment.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to add comment.');
      }
    } finally {
      setIsSavingComment(false);
    }
  };

  return (
    <AppShell title="Issue detail">
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
      <PortalPage className="repo-detail-shell repo-issue-detail-shell">
        <RepoNav
          workspaceId={repoWorkspaceRef}
          repoId={repoRef}
          active="issues"
          viewerRole={repo?.viewerRole}
        />

        {isLoading ? (
          <div className="portal-skeleton-grid">
            <PortalCardSkeleton lines={4} />
            <PortalCardSkeleton lines={5} />
          </div>
        ) : authRequired ? (
          <Card className="stack">
            <p className="muted">Sign in is required to read this issue.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href={`/login?from=${encodeURIComponent(issuePath)}`}>
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
        ) : isMissing || !issue ? (
          <EmptyState title="Issue not found." description="It may have been removed or you may not have access." />
        ) : (
          <div className="repo-detail-layout">
            <div className="repo-detail-main">
              <DetailHeader
                breadcrumbs={[
                  { label: repoWorkspaceRef, href: `/workspaces/${repoWorkspaceRef}` },
                  { label: 'Repos', href: `/workspaces/${repoWorkspaceRef}/repos` },
                  { label: repoRef, href: `/workspaces/${repoWorkspaceRef}/repos/${repoRef}` },
                  { label: 'Issues', href: `/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues` },
                  { label: `#${issue.id}` },
                ]}
                title={issue.title}
                subtitle="Issue discussion and metadata"
                status={statusTone}
                statusLabel={issue.status}
                identifier={`Issue ${issue.id}`}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/issues`}
                    >
                      Back to issues
                    </Button>
                    <Button variant="ghost" size="sm" type="button" onClick={() => void handleCopyLink()}>
                      Copy link
                    </Button>
                    {canWrite ? (
                      <Button
                        variant="primary"
                        size="sm"
                        type="button"
                        onClick={() => void handleToggleStatus()}
                        disabled={isUpdatingStatus}
                      >
                        {isUpdatingStatus ? 'Updating...' : issue.status === 'OPEN' ? 'Close issue' : 'Reopen issue'}
                      </Button>
                    ) : null}
                  </>
                }
              />

              <Card className="repo-issue-detail-summary">
                <h3>Issue summary</h3>
                <div className="repo-issue-detail-summary-grid">
                  <div className="repo-issue-detail-summary-item">
                    <span className="muted">State</span>
                    <strong>{issue.status}</strong>
                  </div>
                  <div className="repo-issue-detail-summary-item">
                    <span className="muted">Author</span>
                    <strong>{userLabel(issue.author)}</strong>
                  </div>
                  <div className="repo-issue-detail-summary-item">
                    <span className="muted">Created</span>
                    <strong>{new Date(issue.createdAt).toLocaleString()}</strong>
                  </div>
                  <div className="repo-issue-detail-summary-item">
                    <span className="muted">Assignees</span>
                    <strong>{issue.assignees.length || 0}</strong>
                  </div>
                  <div className="repo-issue-detail-summary-item">
                    <span className="muted">Labels</span>
                    <strong>{issue.labels.length || 0}</strong>
                  </div>
                </div>
              </Card>

              <Card className="repo-detail-description">
                <h3>Description</h3>
                <MarkdownViewer content={issue.body} emptyMessage="No description provided." />
              </Card>

              <Card className="repo-detail-timeline">
                <h3>Timeline</h3>
                <TimelineItem
                  title="Issue opened"
                  actor={userLabel(issue.author)}
                  createdAt={issue.createdAt}
                  body={issue.body?.trim() || 'No description provided.'}
                  tone="info"
                />
                {comments.length ? (
                  comments.map((comment) => (
                    <TimelineItem
                      key={comment.id}
                      title="Comment added"
                      actor={userLabel(comment.author)}
                      createdAt={comment.createdAt}
                      body={comment.body}
                    />
                  ))
                ) : (
                  <p className="muted">No comments yet.</p>
                )}
              </Card>

              <Card className="repo-detail-comment-card">
                <CommentComposer
                  value={commentDraft}
                  onChange={setCommentDraft}
                  onSubmit={handleCommentSubmit}
                  submitLabel="Add comment"
                  isSubmitting={isSavingComment}
                  isEnabled={canComment}
                  disabledReason={
                    !hasToken
                      ? 'Sign in to contribute.'
                      : forbidden
                        ? 'You do not have permission to comment on this issue.'
                        : !canComment
                          ? 'Commenting is restricted for this issue.'
                          : undefined
                  }
                  loginHref={!hasToken ? `/login?from=${encodeURIComponent(issuePath)}` : undefined}
                />
              </Card>
            </div>

            <aside className="repo-detail-aside">
              <SidebarCard title="Assignees">
                {issue.assignees.length ? (
                  <ul className="repo-detail-meta-list">
                    {issue.assignees.map((assignee) => (
                      <li key={assignee.id}>{userLabel(assignee)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No assignees</p>
                )}
              </SidebarCard>

              <SidebarCard title="Labels">
                {issue.labels.length ? (
                  <div className="repo-detail-label-list">
                    {issue.labels.map((label) => (
                      <span
                        key={label.id}
                        className="repo-inline-chip"
                        style={{
                          borderColor: `${label.color}66`,
                          backgroundColor: `${label.color}1f`,
                        }}
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No labels</p>
                )}
              </SidebarCard>

              <SidebarCard title="Participants">
                {participants.length ? (
                  <ul className="repo-detail-meta-list">
                    {participants.map((participant) => (
                      <li key={participant}>{participant}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No participants</p>
                )}
              </SidebarCard>

              <SidebarCard title="Workflow roles" className="repo-detail-guidance">
                <ul className="repo-detail-meta-list repo-detail-role-list">
                  <li>
                    <span className="muted">Repository</span>
                    <strong>{visibilityLabel}</strong>
                  </li>
                  <li>
                    <span className="muted">Your role</span>
                    <strong>{viewerRoleLabel}</strong>
                  </li>
                  <li>
                    <span className="muted">Mode</span>
                    <strong>{workflowModeLabel}</strong>
                  </li>
                </ul>
                <p className="muted">
                  Assignees own follow-up work. Participants include the author, assignees, and
                  everyone who comments.
                </p>
                {isPersonalFlow ? (
                  <p className="muted">
                    This issue is currently in personal mode. Until additional collaborators
                    interact, assignee and participant lists may contain only you.
                  </p>
                ) : (
                  <p className="muted">
                    This issue is in collaborative mode. Assignees and participants represent the
                    active team working on this thread.
                  </p>
                )}
                {visibilityLabel === 'PUBLIC' ? (
                  <p className="muted">
                    Public repos are readable by everyone. Editing and status updates require write
                    or admin access.
                  </p>
                ) : (
                  <p className="muted">
                    Private repos are visible only to members and invited collaborators. Editing and
                    status updates require write or admin access.
                  </p>
                )}
              </SidebarCard>
            </aside>
          </div>
        )}
      </PortalPage>
    </AppShell>
  );
}

