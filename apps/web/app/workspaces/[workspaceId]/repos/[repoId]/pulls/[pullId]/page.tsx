'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineFormRow,
  Tabs,
  type TabItem,
} from '../../../../../../../src/components/ui';

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

type PullComment = {
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

type PullCheck = {
  id: string;
  context: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILURE';
  details?: string | null;
  createdAt: string;
  updatedAt: string;
};

type PullChecksResponse = {
  checks: PullCheck[];
  summary: {
    headCommitSha?: string | null;
    requiredChecks: string[];
    missingChecks: string[];
    success: number;
    failed: number;
    pending: number;
  };
};

type PullReviewsResponse = {
  reviews: Array<{
    id: string;
    state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    body?: string | null;
    createdAt: string;
    updatedAt: string;
    reviewer: {
      id: string;
      name?: string | null;
      email: string;
      username?: string | null;
    };
  }>;
  summary: {
    requiredApprovals: number;
    approvals: number;
    changesRequested: number;
    requiredChecks: string[];
    missingChecks: string[];
  };
};

type PullTimelineEvent = {
  id: string;
  type: 'OPENED' | 'COMMENTED' | 'REVIEW_REQUESTED' | 'REVIEWED' | 'CHECK_UPDATED' | 'STATUS';
  createdAt: string;
  actor?: {
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  };
  title: string;
  body?: string | null;
};

type PullTimelineResponse = {
  events: PullTimelineEvent[];
};

type PullDiffFile = {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed' | 'unmerged' | 'unknown';
  additions: number;
  deletions: number;
};

type PullDiffResponse = {
  diff: {
    baseBranch: string;
    headBranch: string;
    mergeBaseSha: string;
    aheadBy: number;
    behindBy: number;
    files: PullDiffFile[];
  };
};

type PullPatchResponse = {
  patch: {
    baseBranch: string;
    headBranch: string;
    path: string;
    patch: string;
    isTruncated: boolean;
  };
};

type RepoCommit = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

type PullDetailTab = 'conversation' | 'commits' | 'checks' | 'files';
type PullReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';

function userLabel(user: { name?: string | null; username?: string | null; email: string }) {
  return user.name || user.username || user.email;
}

function timelineTone(
  event: PullTimelineEvent['type'],
): 'default' | 'success' | 'warning' | 'danger' | 'info' {
  if (event === 'CHECK_UPDATED') {
    return 'info';
  }
  if (event === 'STATUS') {
    return 'warning';
  }
  if (event === 'REVIEWED') {
    return 'success';
  }
  return 'default';
}

function normalizeMergeErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes('all approvals and required checks pass')) {
    return 'Merge is blocked until approvals and required checks are complete.';
  }
  if (
    normalized.includes('conflict') ||
    normalized.includes('automatic merge failed') ||
    normalized.includes('not something we can merge')
  ) {
    return 'Merge conflict detected. Rebase or update the source branch, then retry merge.';
  }
  if (normalized.includes('not found')) {
    return 'Pull request could not be updated. Refresh the page and retry.';
  }
  if (normalized.includes('already exists')) {
    return 'Merge failed because the target already contains these changes.';
  }
  if (normalized.includes('command failed')) {
    return 'Merge failed on the server. Verify branch state, approvals, and checks, then retry.';
  }
  return message;
}

function decodeUserIdFromToken(token: string | null): string | null {
  if (!token) {
    return null;
  }
  try {
    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const decoded = JSON.parse(window.atob(payload)) as { sub?: string };
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

function reviewTone(state: PullReviewState): 'success' | 'warning' | 'accent' {
  if (state === 'APPROVED') {
    return 'success';
  }
  if (state === 'CHANGES_REQUESTED') {
    return 'warning';
  }
  return 'accent';
}

function reviewLabel(state: PullReviewState) {
  if (state === 'CHANGES_REQUESTED') {
    return 'Changes requested';
  }
  if (state === 'APPROVED') {
    return 'Approved';
  }
  return 'Commented';
}

function patchLineTone(line: string) {
  if (line.startsWith('@@')) {
    return 'hunk';
  }
  if (line.startsWith('+')) {
    return 'added';
  }
  if (line.startsWith('-')) {
    return 'removed';
  }
  return 'context';
}

export default function PullDetailPage() {
  const params = useParams<{
    workspaceId: string;
    repoId: string;
    pullId: string;
  }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;
  const pullId = params.pullId;

  const tabParam = (searchParams.get('tab') ?? 'conversation').toLowerCase();
  const activeTab: PullDetailTab =
    tabParam === 'checks' || tabParam === 'files' || tabParam === 'commits'
      ? tabParam
      : 'conversation';
  const tabItems: TabItem<PullDetailTab>[] = [
    { key: 'conversation', label: 'Conversation' },
    { key: 'commits', label: 'Commits' },
    { key: 'checks', label: 'Checks' },
    { key: 'files', label: 'Files changed' },
  ];

  const [repo, setRepo] = useState<Repo | null>(null);
  const [pull, setPull] = useState<Pull | null>(null);
  const [comments, setComments] = useState<PullComment[]>([]);
  const [timeline, setTimeline] = useState<PullTimelineEvent[]>([]);
  const [checks, setChecks] = useState<PullChecksResponse | null>(null);
  const [reviews, setReviews] = useState<PullReviewsResponse | null>(null);
  const [diff, setDiff] = useState<PullDiffResponse['diff'] | null>(null);
  const [pullCommits, setPullCommits] = useState<RepoCommit[]>([]);
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<string[]>([]);
  const [patchByPath, setPatchByPath] = useState<Record<string, PullPatchResponse['patch'] | null>>(
    {},
  );
  const [patchLoadingByPath, setPatchLoadingByPath] = useState<Record<string, boolean>>({});
  const [patchErrorByPath, setPatchErrorByPath] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [isMissing, setIsMissing] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [reviewDraft, setReviewDraft] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [capabilities, setCapabilities] = useState({
    timeline: true,
    checks: true,
    diff: true,
    comments: true,
    reviews: true,
    commits: true,
  });

  useEffect(() => {
    const syncToken = () => {
      const token = getToken();
      setHasToken(Boolean(token));
      setViewerUserId(decodeUserIdFromToken(token));
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
    if (!workspaceId || !repoId || !pullId) {
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setStatusMessage(null);
      setAuthRequired(false);
      setForbidden(false);
      setIsMissing(false);
      setExpandedDiffPaths([]);
      setPatchByPath({});
      setPatchLoadingByPath({});
      setPatchErrorByPath({});
      setCapabilities((current) => ({
        ...current,
        timeline: true,
        checks: true,
        diff: true,
        comments: true,
        reviews: true,
        commits: true,
      }));
      try {
        const repoData = await apiFetch<{ repo: Repo }>(
          `/workspaces/${workspaceId}/repos/${repoId}`,
          { suppressAuthRedirect: true },
        );
        setRepo(repoData.repo);
        const resolvedWorkspaceId = repoData.repo.workspace?.id ?? workspaceId;
        const resolvedRepoId = repoData.repo.id ?? repoId;

        const pullResults = await Promise.allSettled([
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls?status=OPEN`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls?status=CLOSED`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls?status=MERGED`,
            { suppressAuthRedirect: true },
          ),
        ]);
        const pullPool = pullResults.flatMap((result) =>
          result.status === 'fulfilled' ? result.value.pulls : [],
        );
        const selectedPull = pullPool.find((entry) => entry.id === pullId) ?? null;
        if (!selectedPull) {
          setIsMissing(true);
          setPull(null);
          return;
        }
        setPull(selectedPull);

        const [timelineResult, commentsResult, checksResult, reviewsResult, diffResult, commitsResult] =
          await Promise.allSettled([
            apiFetch<PullTimelineResponse>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls/${pullId}/timeline`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<{ comments: PullComment[] }>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls/${pullId}/comments`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<PullChecksResponse>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls/${pullId}/checks`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<PullReviewsResponse>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls/${pullId}/reviews`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<PullDiffResponse>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/pulls/${pullId}/diff`,
              { suppressAuthRedirect: true },
            ),
            apiFetch<{ commits: RepoCommit[] }>(
              `/workspaces/${resolvedWorkspaceId}/repos/${resolvedRepoId}/commits?branch=${encodeURIComponent(selectedPull.sourceBranch)}&limit=40`,
              { suppressAuthRedirect: true },
            ),
          ]);

        if (timelineResult.status === 'fulfilled') {
          setTimeline(timelineResult.value.events);
        } else {
          setCapabilities((current) => ({ ...current, timeline: false }));
          setTimeline([]);
        }

        if (commentsResult.status === 'fulfilled') {
          setComments(commentsResult.value.comments);
        } else {
          setCapabilities((current) => ({ ...current, comments: false }));
          setComments([]);
        }

        if (checksResult.status === 'fulfilled') {
          setChecks(checksResult.value);
        } else {
          setCapabilities((current) => ({ ...current, checks: false }));
          setChecks(null);
        }

        if (reviewsResult.status === 'fulfilled') {
          setReviews(reviewsResult.value);
        } else {
          setCapabilities((current) => ({ ...current, reviews: false }));
          setReviews(null);
        }

        if (diffResult.status === 'fulfilled') {
          setDiff(diffResult.value.diff);
        } else {
          setCapabilities((current) => ({ ...current, diff: false }));
          setDiff(null);
        }

        if (commitsResult.status === 'fulfilled') {
          setPullCommits(commitsResult.value.commits);
        } else {
          setCapabilities((current) => ({ ...current, commits: false }));
          setPullCommits([]);
        }
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to view this pull request.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have permission to read this repository.');
          } else if (err.status === 404) {
            setIsMissing(true);
            setError('Pull request not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load pull request.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [pullId, repoId, workspaceId]);

  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;
  const repoWorkspaceApiId = repo?.workspace?.id ?? workspaceId;
  const repoApiId = repo?.id ?? repoId;
  const pullPath = `/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls/${pullId}`;
  const viewerRoleLabel = repo?.viewerRole ?? 'READ';
  const visibilityLabel = repo?.visibility ?? 'PRIVATE';
  const canWrite = repo?.viewerRole === 'WRITE' || repo?.viewerRole === 'ADMIN';
  const canComment = Boolean(pull) && hasToken && !authRequired && !forbidden && capabilities.comments;
  const canReview = Boolean(pull) && hasToken && !authRequired && !forbidden && capabilities.reviews;
  const pullStatusTone =
    pull?.status === 'OPEN' ? 'open' : pull?.status === 'MERGED' ? 'merged' : 'closed';

  const mergeBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (capabilities.reviews && !reviews) {
      blockers.push('Review status is still loading');
    }
    if (capabilities.checks && !checks) {
      blockers.push('Required checks are still loading');
    }
    if (reviews?.summary.changesRequested && reviews.summary.changesRequested > 0) {
      blockers.push('Changes have been requested');
    }
    if (
      reviews &&
      reviews.summary.requiredApprovals > 0 &&
      reviews.summary.approvals < reviews.summary.requiredApprovals
    ) {
      blockers.push(
        `${reviews.summary.requiredApprovals - reviews.summary.approvals} more approval(s) required`,
      );
    }
    if (checks?.summary.missingChecks?.length) {
      blockers.push(`Missing checks: ${checks.summary.missingChecks.join(', ')}`);
    }
    return blockers;
  }, [capabilities.checks, capabilities.reviews, checks, reviews]);

  const checksByStatus = useMemo(() => {
    const groups: {
      success: PullCheck[];
      failed: PullCheck[];
      pending: PullCheck[];
    } = {
      success: [],
      failed: [],
      pending: [],
    };
    if (!checks) {
      return groups;
    }
    checks.checks.forEach((check) => {
      if (check.status === 'SUCCESS') {
        groups.success.push(check);
        return;
      }
      if (check.status === 'FAILURE') {
        groups.failed.push(check);
        return;
      }
      groups.pending.push(check);
    });
    return groups;
  }, [checks]);

  const checkStatusByContext = useMemo(() => {
    const statusMap = new Map<string, PullCheck['status']>();
    checks?.checks.forEach((check) => {
      statusMap.set(check.context.toLowerCase(), check.status);
    });
    return statusMap;
  }, [checks]);

  const canMerge =
    pull?.status === 'OPEN' && canWrite && !isMerging && mergeBlockers.length === 0;

  const participants = useMemo(() => {
    if (!pull) {
      return [] as string[];
    }
    const values = new Set<string>();
    values.add(userLabel(pull.author));
    pull.assignees.forEach((assignee) => values.add(userLabel(assignee)));
    comments.forEach((comment) => values.add(userLabel(comment.author)));
    timeline.forEach((event) => {
      if (event.actor) {
        values.add(userLabel(event.actor));
      }
    });
    return [...values];
  }, [comments, pull, timeline]);
  const workflowModeLabel = participants.length > 1 ? 'Collaborative' : 'Personal';
  const isPersonalFlow = workflowModeLabel === 'Personal';
  const isPullAuthor = Boolean(viewerUserId && pull && viewerUserId === pull.author.id);
  const myReview = useMemo(() => {
    if (!reviews || !viewerUserId) {
      return null;
    }
    return reviews.reviews.find((review) => review.reviewer.id === viewerUserId) ?? null;
  }, [reviews, viewerUserId]);
  const branchFlowLabel =
    pull && pull.sourceBranch === pull.targetBranch
      ? 'Same branch (invalid)'
      : 'Direct branch flow';

  const pullDescription = useMemo(() => {
    const openedEvent = timeline.find(
      (event) => event.type === 'OPENED' && Boolean(event.body?.trim()),
    );
    return openedEvent?.body?.trim() ?? '';
  }, [timeline]);

  const loadPatchForPath = async (path: string) => {
    if (!capabilities.diff || patchByPath[path] !== undefined || patchLoadingByPath[path]) {
      return;
    }

    setPatchLoadingByPath((current) => ({ ...current, [path]: true }));
    try {
      const data = await apiFetch<PullPatchResponse>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pullId}/diff/file?path=${encodeURIComponent(path)}`,
        { suppressAuthRedirect: true },
      );
      setPatchByPath((current) => ({ ...current, [path]: data.patch }));
      setPatchErrorByPath((current) => {
        if (!current[path]) {
          return current;
        }
        const next = { ...current };
        delete next[path];
        return next;
      });
    } catch {
      setPatchByPath((current) => ({ ...current, [path]: null }));
      setPatchErrorByPath((current) => ({
        ...current,
        [path]: 'Patch preview could not be loaded for this file.',
      }));
    } finally {
      setPatchLoadingByPath((current) => ({ ...current, [path]: false }));
    }
  };

  const toggleDiffPath = (path: string) => {
    const isExpanded = expandedDiffPaths.includes(path);
    if (isExpanded) {
      setExpandedDiffPaths((current) => current.filter((entry) => entry !== path));
      return;
    }
    setExpandedDiffPaths((current) => [...current, path]);
    void loadPatchForPath(path);
  };

  const handleExpandAllPatches = () => {
    if (!diff?.files.length) {
      return;
    }
    const allPaths = diff.files.map((file) => file.path);
    setExpandedDiffPaths(allPaths);
    allPaths.forEach((path) => {
      void loadPatchForPath(path);
    });
  };

  const handleCollapseAllPatches = () => {
    setExpandedDiffPaths([]);
  };

  const handleCopyFilePath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setStatusMessage(`Copied file path: ${path}`);
    } catch {
      setError('Unable to copy file path.');
    }
  };

  const updateTab = (tab: PullDetailTab) => {
    const paramsNext = new URLSearchParams(searchParams.toString());
    if (tab === 'conversation') {
      paramsNext.delete('tab');
    } else {
      paramsNext.set('tab', tab);
    }
    const query = paramsNext.toString();
    const nextPath = query
      ? `/workspaces/${workspaceId}/repos/${repoId}/pulls/${pullId}?${query}`
      : `/workspaces/${workspaceId}/repos/${repoId}/pulls/${pullId}`;
    router.push(nextPath);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setStatusMessage('Pull request link copied.');
    } catch {
      setError('Unable to copy link.');
    }
  };

  const refreshConversation = async () => {
    const [timelineResult, commentsResult] = await Promise.allSettled([
      apiFetch<PullTimelineResponse>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pullId}/timeline`,
        { suppressAuthRedirect: true },
      ),
      apiFetch<{ comments: PullComment[] }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pullId}/comments`,
        { suppressAuthRedirect: true },
      ),
    ]);

    if (timelineResult.status === 'fulfilled') {
      setTimeline(timelineResult.value.events);
    }
    if (commentsResult.status === 'fulfilled') {
      setComments(commentsResult.value.comments);
    }
  };

  const refreshReviews = async () => {
    if (!capabilities.reviews) {
      return;
    }
    try {
      const reviewsResult = await apiFetch<PullReviewsResponse>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pullId}/reviews`,
        { suppressAuthRedirect: true },
      );
      setReviews(reviewsResult);
    } catch {
      setCapabilities((current) => ({ ...current, reviews: false }));
    }
  };

  const refreshChecks = async () => {
    if (!capabilities.checks) {
      return;
    }
    try {
      const checksResult = await apiFetch<PullChecksResponse>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pullId}/checks`,
        { suppressAuthRedirect: true },
      );
      setChecks(checksResult);
    } catch {
      setCapabilities((current) => ({ ...current, checks: false }));
    }
  };

  const handleReviewSubmit = async (state: PullReviewState) => {
    if (!pull || !hasToken || forbidden || authRequired || isSubmittingReview) {
      return;
    }
    if (!capabilities.reviews) {
      setError('Review actions are not available on this repository.');
      return;
    }
    setIsSubmittingReview(true);
    try {
      await apiFetch<{ review: PullReviewsResponse['reviews'][number] }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pull.id}/reviews`,
        {
          method: 'PUT',
          body: JSON.stringify({
            state,
            body: reviewDraft.trim() || undefined,
          }),
          suppressAuthRedirect: true,
        },
      );
      setReviewDraft('');
      await Promise.all([refreshConversation(), refreshReviews(), refreshChecks()]);
      setStatusMessage(`Review submitted: ${reviewLabel(state)}.`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setAuthRequired(true);
        setError('Sign in is required to submit a review.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unable to submit review.');
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleCommentSubmit = async () => {
    if (!pull || !commentDraft.trim() || !canComment || isSavingComment) {
      return;
    }
    setIsSavingComment(true);
    try {
      await apiFetch<{ comment: PullComment }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pull.id}/comments`,
        {
          method: 'POST',
          body: JSON.stringify({ body: commentDraft.trim() }),
          suppressAuthRedirect: true,
        },
      );
      setCommentDraft('');
      await refreshConversation();
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

  const handleMerge = async () => {
    if (!pull || !canMerge) {
      return;
    }
    setIsMerging(true);
    try {
      const data = await apiFetch<{ pull: Pull }>(
        `/workspaces/${repoWorkspaceApiId}/repos/${repoApiId}/pulls/${pull.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'MERGED' }),
          suppressAuthRedirect: true,
        },
      );
      setPull(data.pull);
      setStatusMessage('Pull request merged.');
      await refreshConversation();
    } catch (err) {
      if (err instanceof Error) {
        setError(normalizeMergeErrorMessage(err.message));
      } else {
        setError('Unable to merge pull request.');
      }
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <AppShell title="Pull request detail">
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
      <PortalPage className="repo-detail-shell repo-pull-detail-shell">
        <RepoNav
          workspaceId={repoWorkspaceRef}
          repoId={repoRef}
          active="pulls"
          viewerRole={repo?.viewerRole}
        />

        {isLoading ? (
          <div className="portal-skeleton-grid">
            <PortalCardSkeleton lines={4} />
            <PortalCardSkeleton lines={5} />
          </div>
        ) : authRequired ? (
          <Card className="stack">
            <p className="muted">Sign in is required to view this pull request.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href={`/login?from=${encodeURIComponent(pullPath)}`}>
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
        ) : isMissing || !pull ? (
          <EmptyState
            title="Pull request not found."
            description="It may have been removed or you may not have access."
          />
        ) : (
          <div className="repo-detail-layout">
            <div className="repo-detail-main">
              <DetailHeader
                breadcrumbs={[
                  { label: repoWorkspaceRef, href: `/workspaces/${repoWorkspaceRef}` },
                  { label: 'Repos', href: `/workspaces/${repoWorkspaceRef}/repos` },
                  { label: repoRef, href: `/workspaces/${repoWorkspaceRef}/repos/${repoRef}` },
                  { label: 'Pull requests', href: `/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls` },
                  { label: `#${pull.id}` },
                ]}
                title={pull.title}
                subtitle={`${pull.sourceBranch} into ${pull.targetBranch}`}
                status={pullStatusTone}
                statusLabel={pull.status}
                identifier={`Pull ${pull.id}`}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}/pulls`}
                    >
                      Back to pulls
                    </Button>
                    {capabilities.checks && checks ? (
                      <Badge
                        tone={
                          checks.summary.failed > 0
                            ? 'danger'
                            : checks.summary.pending > 0
                              ? 'warning'
                              : 'success'
                        }
                      >
                        Checks {checks.summary.success}/{checks.checks.length}
                      </Badge>
                    ) : null}
                    <Button variant="ghost" size="sm" type="button" onClick={() => void handleCopyLink()}>
                      Copy link
                    </Button>
                  </>
                }
              />

              <Card className="repo-detail-subtabs">
                <Tabs
                  items={tabItems}
                  activeKey={activeTab}
                  onChange={updateTab}
                  ariaLabel="Pull request detail tabs"
                  className="repo-detail-tab-strip"
                />
              </Card>

              {activeTab === 'conversation' ? (
                <>
                  <Card className="repo-pr-detail-summary">
                    <h3>Pull request summary</h3>
                    <div className="repo-pr-detail-summary-grid">
                      <div className="repo-pr-detail-summary-item">
                        <span className="muted">Author</span>
                        <strong>{userLabel(pull.author)}</strong>
                      </div>
                      <div className="repo-pr-detail-summary-item">
                        <span className="muted">Created</span>
                        <strong>{new Date(pull.createdAt).toLocaleString()}</strong>
                      </div>
                      <div className="repo-pr-detail-summary-item">
                        <span className="muted">Source branch</span>
                        <strong>{pull.sourceBranch}</strong>
                      </div>
                      <div className="repo-pr-detail-summary-item">
                        <span className="muted">Target branch</span>
                        <strong>{pull.targetBranch}</strong>
                      </div>
                    </div>
                  </Card>

                  <Card className="repo-detail-description">
                    <h3>Description</h3>
                    <MarkdownViewer content={pullDescription} emptyMessage="No description provided." />
                  </Card>

                  <Card className="repo-pr-detail-review-card">
                    <div className="repo-pr-detail-review-head">
                      <h3>Review decision</h3>
                      {myReview ? (
                        <Badge tone={reviewTone(myReview.state)}>{reviewLabel(myReview.state)}</Badge>
                      ) : (
                        <Badge tone="neutral">No decision yet</Badge>
                      )}
                    </div>
                    <p className="muted">
                      Approve to unblock merge, request changes to block merge, or leave a comment-only
                      review.
                    </p>
                    <label className="repo-pr-detail-review-note">
                      <span className="muted">Review note (optional)</span>
                      <textarea
                        value={reviewDraft}
                        onChange={(event) => setReviewDraft(event.target.value)}
                        placeholder="Share feedback for the author..."
                        disabled={!canReview || pull.status !== 'OPEN' || isSubmittingReview}
                      />
                    </label>
                    {!hasToken ? (
                      <p className="muted">
                        Sign in to submit review decisions on pull requests.
                      </p>
                    ) : null}
                    {isPullAuthor ? (
                      <p className="muted">
                        You authored this pull request. Approve is disabled, but you can still comment or
                        request changes.
                      </p>
                    ) : null}
                    <InlineFormRow align="start" className="repo-pr-detail-review-actions">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={
                          !canReview ||
                          isSubmittingReview ||
                          pull.status !== 'OPEN' ||
                          isPullAuthor
                        }
                        onClick={() => void handleReviewSubmit('APPROVED')}
                      >
                        {isSubmittingReview ? 'Submitting...' : 'Approve'}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={!canReview || isSubmittingReview || pull.status !== 'OPEN'}
                        onClick={() => void handleReviewSubmit('CHANGES_REQUESTED')}
                      >
                        Request changes
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canReview || isSubmittingReview || pull.status !== 'OPEN'}
                        onClick={() => void handleReviewSubmit('COMMENTED')}
                      >
                        Comment only
                      </Button>
                    </InlineFormRow>
                    {reviews?.reviews?.length ? (
                      <div className="repo-pr-detail-recent-reviews">
                        {reviews.reviews.slice(0, 4).map((review) => (
                          <div key={review.id} className="repo-pr-detail-review-item">
                            <strong>{userLabel(review.reviewer)}</strong>
                            <Badge tone={reviewTone(review.state)}>{reviewLabel(review.state)}</Badge>
                            <span className="muted">
                              {new Date(review.updatedAt).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Card>

                  <Card className="repo-detail-merge-box">
                    <h3>Merge</h3>
                    <ul className="repo-pr-detail-merge-summary">
                      <li>
                        Approvals:{' '}
                        {reviews
                          ? `${reviews.summary.approvals}/${reviews.summary.requiredApprovals}`
                          : 'Pending'}
                      </li>
                      <li>
                        Required checks:{' '}
                        {capabilities.checks && checks
                          ? checks.summary.requiredChecks.length
                            ? checks.summary.requiredChecks.join(', ')
                            : 'None'
                          : 'Pending'}
                      </li>
                      <li>Conflicts: No conflicts reported.</li>
                    </ul>
                    {pull.status !== 'OPEN' ? (
                      <p className="muted">This pull request is already {pull.status.toLowerCase()}.</p>
                    ) : !canWrite ? (
                      <p className="muted">You have read access. Merge is restricted to write/admin roles.</p>
                    ) : (
                      <>
                        {mergeBlockers.length ? (
                          <ul className="repo-detail-warning-list">
                            {mergeBlockers.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">Ready to merge.</p>
                        )}
                        {!canMerge ? (
                          <p className="repo-detail-warning">
                            Merge is disabled until required approvals and checks pass. Use the review
                            actions above to approve or request changes.
                          </p>
                        ) : null}
                        <Button
                          variant="primary"
                          size="sm"
                          type="button"
                          onClick={() => void handleMerge()}
                          disabled={!canMerge}
                        >
                          {isMerging ? 'Merging...' : 'Merge pull request'}
                        </Button>
                      </>
                    )}
                  </Card>

                  <Card className="repo-detail-timeline">
                    <h3>Timeline</h3>
                    {capabilities.timeline ? (
                      timeline.length ? (
                        timeline.map((event) => (
                          <TimelineItem
                            key={event.id}
                            title={event.title}
                            body={event.body}
                            actor={event.actor ? userLabel(event.actor) : undefined}
                            createdAt={event.createdAt}
                            tone={timelineTone(event.type)}
                          />
                        ))
                      ) : (
                        <p className="muted">No timeline events yet.</p>
                      )
                    ) : (
                      <p className="muted">Timeline data is not currently returned for this pull request.</p>
                    )}
                  </Card>

                  <Card className="repo-detail-timeline">
                    <h3>Comments</h3>
                    {capabilities.comments ? (
                      comments.length ? (
                        comments.map((comment) => (
                          <TimelineItem
                            key={comment.id}
                            title="Comment added"
                            body={comment.body}
                            actor={userLabel(comment.author)}
                            createdAt={comment.createdAt}
                          />
                        ))
                      ) : (
                        <p className="muted">No comments yet.</p>
                      )
                    ) : (
                      <p className="muted">Comments data is not currently returned for this pull request.</p>
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
                            ? 'You do not have permission to comment on this pull request.'
                            : !canComment
                              ? 'Commenting is restricted for this pull request.'
                              : undefined
                      }
                      loginHref={!hasToken ? `/login?from=${encodeURIComponent(pullPath)}` : undefined}
                    />
                  </Card>
                </>
              ) : null}

              {activeTab === 'commits' ? (
                <Card className="repo-detail-checks">
                  <h3>Commits</h3>
                  {capabilities.commits ? (
                    pullCommits.length ? (
                      <ul className="repo-detail-check-list">
                        {pullCommits.map((commit) => (
                          <li key={commit.sha}>
                            <strong>{commit.message || commit.sha.slice(0, 7)}</strong>
                            <span>
                              {commit.author} - {new Date(commit.date).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted">No commits found on the source branch.</p>
                    )
                  ) : (
                    <p className="muted">Commit history could not be loaded for this branch.</p>
                  )}
                </Card>
              ) : null}

              {activeTab === 'checks' ? (
                <Card className="repo-detail-checks">
                  <h3>Checks</h3>
                  {capabilities.checks && checks ? (
                    <>
                      <div className="repo-pr-detail-check-cards">
                        <article className="repo-pr-detail-check-card tone-success">
                          <span>Passing</span>
                          <strong>{checks.summary.success}</strong>
                        </article>
                        <article className="repo-pr-detail-check-card tone-danger">
                          <span>Failed</span>
                          <strong>{checks.summary.failed}</strong>
                        </article>
                        <article className="repo-pr-detail-check-card tone-warning">
                          <span>Pending</span>
                          <strong>{checks.summary.pending}</strong>
                        </article>
                        <article className="repo-pr-detail-check-card tone-info">
                          <span>Required</span>
                          <strong>{checks.summary.requiredChecks.length}</strong>
                        </article>
                      </div>
                      {checks.summary.requiredChecks.length ? (
                        <div className="repo-pr-detail-required-checks">
                          <span className="muted">Required checks</span>
                          <ul>
                            {checks.summary.requiredChecks.map((context) => {
                              const status = checkStatusByContext.get(context.toLowerCase());
                              const tone =
                                status === 'SUCCESS'
                                  ? 'success'
                                  : status === 'FAILURE'
                                    ? 'danger'
                                    : 'warning';
                              const label = status ? status.replace('_', ' ') : 'MISSING';
                              return (
                                <li key={context}>
                                  <span>{context}</span>
                                  <Badge tone={tone}>{label}</Badge>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {checks.summary.missingChecks.length ? (
                        <p className="repo-detail-warning">
                          Missing checks: {checks.summary.missingChecks.join(', ')}
                        </p>
                      ) : null}
                      <div className="repo-pr-detail-check-groups">
                        {checksByStatus.failed.length ? (
                          <div className="repo-pr-detail-check-group">
                            <h4>Failed</h4>
                            <ul className="repo-detail-check-list">
                              {checksByStatus.failed.map((check) => (
                                <li key={check.id}>
                                  <strong>{check.context}</strong>
                                  <span>{check.status}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {checksByStatus.pending.length ? (
                          <div className="repo-pr-detail-check-group">
                            <h4>Pending</h4>
                            <ul className="repo-detail-check-list">
                              {checksByStatus.pending.map((check) => (
                                <li key={check.id}>
                                  <strong>{check.context}</strong>
                                  <span>{check.status}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {checksByStatus.success.length ? (
                          <div className="repo-pr-detail-check-group">
                            <h4>Successful</h4>
                            <ul className="repo-detail-check-list">
                              {checksByStatus.success.map((check) => (
                                <li key={check.id}>
                                  <strong>{check.context}</strong>
                                  <span>{check.status}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <p className="muted">Checks data could not be loaded for this pull request.</p>
                  )}
                </Card>
              ) : null}

              {activeTab === 'files' ? (
                <Card className="repo-detail-files">
                  <h3>Files changed</h3>
                  {capabilities.diff && diff ? (
                    <>
                      <div className="repo-pr-detail-files-toolbar">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleExpandAllPatches()}
                          disabled={!diff.files.length}
                        >
                          Expand all
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCollapseAllPatches()}
                          disabled={!expandedDiffPaths.length}
                        >
                          Collapse all
                        </Button>
                      </div>
                      {diff.files.length ? (
                        <ul className="repo-detail-diff-list">
                          {diff.files.map((file) => (
                            <li key={file.path}>
                              <div className="repo-pr-detail-file-row">
                                <button
                                  type="button"
                                  className={expandedDiffPaths.includes(file.path) ? 'is-active' : ''}
                                  onClick={() => toggleDiffPath(file.path)}
                                >
                                  <span className="repo-pr-detail-file-row-title">{file.path}</span>
                                  <span className="repo-pr-detail-file-row-meta">
                                    <Badge tone="neutral">{file.status}</Badge>
                                    <span className="repo-diff-stat repo-diff-stat--added">
                                      +{file.additions}
                                    </span>
                                    <span className="repo-diff-stat repo-diff-stat--removed">
                                      -{file.deletions}
                                    </span>
                                  </span>
                                </button>
                                <div className="repo-pr-detail-file-row-actions">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleCopyFilePath(file.path)}
                                  >
                                    Copy path
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    href={`/workspaces/${repoWorkspaceRef}/repos/${repoRef}?branch=${encodeURIComponent(pull.sourceBranch)}&file=${encodeURIComponent(file.path)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open file
                                  </Button>
                                </div>
                              </div>
                              {expandedDiffPaths.includes(file.path) ? (
                                <div className="repo-detail-patch-view">
                                  {patchLoadingByPath[file.path] ? (
                                    <p className="muted">Loading patch...</p>
                                  ) : patchByPath[file.path] ? (
                                    <>
                                      {patchByPath[file.path]?.isTruncated ? (
                                        <p className="muted">
                                          Patch is too large to fully preview. Raw view is disabled here.
                                        </p>
                                      ) : null}
                                      {patchByPath[file.path]?.patch ? (
                                        <div className="repo-diff-lines" role="table" aria-label={`Patch for ${file.path}`}>
                                          {patchByPath[file.path]?.patch
                                            .split('\n')
                                            .map((line, lineIndex) => (
                                              <div
                                                key={`${file.path}-${lineIndex}`}
                                                className={`repo-diff-line repo-diff-line--${patchLineTone(line)}`}
                                                role="row"
                                              >
                                                <span className="repo-diff-line-number" role="cell">
                                                  {lineIndex + 1}
                                                </span>
                                                <span className="repo-diff-line-sign" role="cell">
                                                  {line.startsWith('+')
                                                    ? '+'
                                                    : line.startsWith('-')
                                                      ? '-'
                                                      : line.startsWith('@@')
                                                        ? '@@'
                                                        : ' '}
                                                </span>
                                                <code className="repo-diff-line-content" role="cell">
                                                  {line === '' ? ' ' : line}
                                                </code>
                                              </div>
                                            ))}
                                        </div>
                                      ) : (
                                        <p className="muted">
                                          Binary or non-text diff. Raw view is disabled here.
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <p className="muted">
                                      {patchErrorByPath[file.path] ??
                                        'Patch preview could not be loaded for this file.'}
                                    </p>
                                  )}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="muted">No changed files found.</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">Changed files data could not be loaded.</p>
                  )}
                </Card>
              ) : null}
            </div>

            <aside className="repo-detail-aside">
              <SidebarCard title="Assignees">
                {pull.assignees.length ? (
                  <ul className="repo-detail-meta-list">
                    {pull.assignees.map((assignee) => (
                      <li key={assignee.id}>{userLabel(assignee)}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No assignees</p>
                )}
              </SidebarCard>

              <SidebarCard title="Labels">
                {pull.labels.length ? (
                  <div className="repo-detail-label-list">
                    {pull.labels.map((label) => (
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

              <SidebarCard title="Review summary">
                {capabilities.reviews && reviews ? (
                  <ul className="repo-detail-meta-list">
                    <li>Your decision: {myReview ? reviewLabel(myReview.state) : 'None yet'}</li>
                    <li>
                      Approvals: {reviews.summary.approvals}/{reviews.summary.requiredApprovals}
                    </li>
                    <li>Changes requested: {reviews.summary.changesRequested}</li>
                    <li>
                      Missing checks: {reviews.summary.missingChecks.length}
                    </li>
                  </ul>
                ) : (
                  <p className="muted">Review summary could not be loaded.</p>
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
                  <li>
                    <span className="muted">Flow</span>
                    <strong>{branchFlowLabel}</strong>
                  </li>
                </ul>
                <p className="muted">
                  Reviewers and assignees coordinate approval. Participants include author,
                  assignees, reviewers, and commenters.
                </p>
                {isPersonalFlow ? (
                  <p className="muted">
                    This pull request is currently personal flow. Approvals stay optional until
                    additional reviewers or collaborators participate.
                  </p>
                ) : (
                  <p className="muted">
                    This pull request is collaborative flow. Team approvals and checks should be
                    satisfied before merge.
                  </p>
                )}
                <p className="muted">
                  Fork-based pull requests are not configured in this workspace UI; reviews run on
                  source/target branches in the same repository.
                </p>
                <p className="muted">
                  Merge requires write/admin access plus the configured checks and approval policy.
                </p>
              </SidebarCard>
            </aside>
          </div>
        )}
      </PortalPage>
    </AppShell>
  );
}



