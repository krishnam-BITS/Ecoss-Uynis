import { ApiRequestError, apiFetch } from './api';
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from './workspace';

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
  visibility?: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
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
  labels?: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
  assignees: Array<{
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  }>;
};

type PullRequest = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  createdAt: string;
  author: {
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  };
  labels?: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
  assignees: Array<{
    id: string;
    name?: string | null;
    email: string;
    username?: string | null;
  }>;
};

type RepoDetailResponse = {
  repo: {
    id: string;
    slug: string;
    viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
    workspace?: {
      slug?: string;
    };
  };
};

export type TaskViewerRole = 'READ' | 'WRITE' | 'ADMIN' | null;
export type TaskLane = 'BACKLOG' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export type TaskScope = 'global' | 'workspace' | 'repo';

export type TaskItem = {
  id: string;
  type: 'ISSUE' | 'PULL';
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  lane: TaskLane;
  title: string;
  createdAt: string;
  authorLabel: string;
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
    color?: string;
  }>;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  repoId: string;
  repoName: string;
  repoSlug: string;
  viewerRole: TaskViewerRole;
};

export type TaskRepoContext = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  repoId: string;
  repoName: string;
  repoSlug: string;
  viewerRole: TaskViewerRole;
};

type TaskFetchAccess = {
  authRequired: boolean;
  forbidden: boolean;
  partial: boolean;
};

export async function fetchTaskItems({
  statusFilter = 'ALL',
  scope = 'global',
  workspaceRef,
  repoRef,
}: {
  statusFilter?: 'OPEN' | 'ALL';
  scope?: TaskScope;
  workspaceRef?: string;
  repoRef?: string;
} = {}): Promise<{
  items: TaskItem[];
  openIssueCount: number;
  openPullCount: number;
  activeWorkspace: Workspace | null;
  workspaceOptions: Workspace[];
  repoOptions: TaskRepoContext[];
  access: TaskFetchAccess;
}> {
  const workspaceData = await apiFetch<{ workspaces: Workspace[] }>('/workspaces', {
    suppressAuthRedirect: true,
  });
  const workspaceList = workspaceData.workspaces;
  if (!workspaceList.length) {
    return {
      items: [],
      openIssueCount: 0,
      openPullCount: 0,
      activeWorkspace: null,
      workspaceOptions: [],
      repoOptions: [],
      access: {
        authRequired: false,
        forbidden: false,
        partial: false,
      },
    };
  }

  const matchRef = (value: string | undefined, id: string, slug: string) => {
    if (!value) {
      return false;
    }
    return value.toLowerCase() === id.toLowerCase() || value.toLowerCase() === slug.toLowerCase();
  };

  const selectedWorkspaceId = getSelectedWorkspaceId();
  const defaultWorkspace =
    (selectedWorkspaceId
      ? workspaceList.find((workspace) => workspace.id === selectedWorkspaceId)
      : null) ??
    workspaceList.find((workspace) => workspace.isPersonal) ??
    workspaceList[0] ??
    null;

  const scopedWorkspace =
    workspaceRef
      ? workspaceList.find((workspace) => matchRef(workspaceRef, workspace.id, workspace.slug))
      : defaultWorkspace;

  if (scopedWorkspace) {
    setSelectedWorkspaceId(scopedWorkspace.id);
  }

  const scopedWorkspaces =
    scope === 'global'
      ? workspaceList
      : scopedWorkspace
        ? [scopedWorkspace]
        : [];

  const repoResults = await Promise.all(
    scopedWorkspaces.map((workspace) =>
      apiFetch<{ repos: Repo[] }>(`/workspaces/${workspace.id}/repos`, {
        suppressAuthRedirect: true,
      }).then((data) => ({
        workspace,
        repos: data.repos,
      })),
    ),
  );

  let repoEntries = repoResults.flatMap((entry) =>
    entry.repos.map((repo) => ({
      workspace: entry.workspace,
      repo,
    })),
  );

  if (scope === 'repo' && repoRef) {
    repoEntries = repoEntries.filter((entry) =>
      matchRef(repoRef, entry.repo.id, entry.repo.slug),
    );
  }

  if (!repoEntries.length) {
    return {
      items: [],
      openIssueCount: 0,
      openPullCount: 0,
      activeWorkspace: scopedWorkspace ?? defaultWorkspace,
      workspaceOptions: workspaceList,
      repoOptions: [],
      access: {
        authRequired: false,
        forbidden: false,
        partial: false,
      },
    };
  }

  const workResults = await Promise.allSettled(
    repoEntries.map(async ({ workspace, repo }) => {
      const [repoDetail, issueData, pullData] = await Promise.all([
        apiFetch<RepoDetailResponse>(`/workspaces/${workspace.id}/repos/${repo.id}`, {
          suppressAuthRedirect: true,
        }),
        apiFetch<{ issues: Issue[] }>(
          `/workspaces/${workspace.id}/repos/${repo.id}/issues${
            statusFilter === 'ALL' ? '' : `?status=${statusFilter}`
          }`,
        ),
        apiFetch<{ pulls: PullRequest[] }>(
          `/workspaces/${workspace.id}/repos/${repo.id}/pulls${
            statusFilter === 'ALL' ? '' : `?status=${statusFilter}`
          }`,
        ),
      ]);

      const viewerRole = repoDetail.repo.viewerRole ?? 'READ';
      const workspaceSlug = repoDetail.repo.workspace?.slug || workspace.slug;
      const repoSlug = repoDetail.repo.slug || repo.slug;

      const issueItems: TaskItem[] = issueData.issues.map((issue) => ({
        id: issue.id,
        type: 'ISSUE',
        status: issue.status,
        lane: deriveTaskLane({
          type: 'ISSUE',
          status: issue.status,
          assignees: issue.assignees ?? [],
          labels: issue.labels ?? [],
        }),
        title: issue.title,
        createdAt: issue.createdAt,
        authorLabel: issue.author.name ?? issue.author.email,
        author: issue.author,
        assignees: issue.assignees ?? [],
        labels: issue.labels ?? [],
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug,
        repoId: repo.id,
        repoName: repo.name,
        repoSlug,
        viewerRole,
      }));

      const pullItems: TaskItem[] = pullData.pulls.map((pull) => ({
        id: pull.id,
        type: 'PULL',
        status: pull.status,
        lane: deriveTaskLane({
          type: 'PULL',
          status: pull.status,
          assignees: pull.assignees ?? [],
          labels: pull.labels ?? [],
        }),
        title: pull.title,
        createdAt: pull.createdAt,
        authorLabel: pull.author.name ?? pull.author.email,
        author: pull.author,
        assignees: pull.assignees ?? [],
        labels: pull.labels ?? [],
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug,
        repoId: repo.id,
        repoName: repo.name,
        repoSlug,
        viewerRole,
      }));

      const context: TaskRepoContext = {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceSlug,
        repoId: repo.id,
        repoName: repo.name,
        repoSlug,
        viewerRole,
      };

      return { issueItems, pullItems, context };
    }),
  );

  const resolved = workResults.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const rejectedReasons = workResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  const authRequired = rejectedReasons.some(
    (reason) => reason instanceof ApiRequestError && reason.status === 401,
  );
  const forbidden = rejectedReasons.some(
    (reason) => reason instanceof ApiRequestError && reason.status === 403,
  );
  const partial = resolved.length > 0 && rejectedReasons.length > 0;
  const allIssues = resolved.flatMap((result) => result.issueItems);
  const allPulls = resolved.flatMap((result) => result.pullItems);
  const items = [...allIssues, ...allPulls].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const repoOptions = resolved.map((result) => result.context).sort((left, right) => {
    if (left.workspaceName === right.workspaceName) {
      return left.repoName.localeCompare(right.repoName);
    }
    return left.workspaceName.localeCompare(right.workspaceName);
  });

  const openIssueCount = allIssues.filter((issue) => issue.status === 'OPEN').length;
  const openPullCount = allPulls.filter((pull) => pull.status === 'OPEN').length;

  return {
    items,
    openIssueCount,
    openPullCount,
    activeWorkspace: scopedWorkspace ?? defaultWorkspace,
    workspaceOptions: workspaceList,
    repoOptions,
    access: {
      authRequired,
      forbidden,
      partial,
    },
  };
}

export function deriveTaskLane(input: {
  type: 'ISSUE' | 'PULL';
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  assignees: Array<{ id: string }>;
  labels?: Array<{ name: string }>;
}): TaskLane {
  if (input.status !== 'OPEN') {
    return 'DONE';
  }
  if (input.type === 'PULL') {
    return 'REVIEW';
  }
  const hasReviewLabel = (input.labels ?? []).some((label) =>
    label.name.toLowerCase().includes('review'),
  );
  if (hasReviewLabel) {
    return 'REVIEW';
  }
  return input.assignees.length ? 'IN_PROGRESS' : 'BACKLOG';
}
