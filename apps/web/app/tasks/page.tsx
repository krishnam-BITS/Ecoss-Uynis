'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { PortalToast } from '../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import {
  deriveTaskLane,
  fetchTaskItems,
  type TaskItem,
  type TaskLane,
  type TaskRepoContext,
  type TaskScope,
} from '../../lib/tasks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineFormRow,
  Modal,
  SectionHeader,
  SkeletonLines,
  Table,
  Tabs,
  type TabItem,
} from '../../src/components/ui';

type ViewMode = 'list' | 'board';
type StatusFilter = 'OPEN' | 'ALL';
type TypeFilter = 'ALL' | 'ISSUE' | 'PULL';
type AssigneeFilter = 'ALL' | 'MINE' | 'UNASSIGNED';
type LaneFilter = 'ALL' | TaskLane;

type MemberUser = {
  id: string;
  name?: string | null;
  email: string;
  username?: string | null;
};

type WorkspaceMember = {
  user: MemberUser;
};

type DragState = {
  itemKey: string;
  lane: TaskLane;
};

type ApiIssue = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  author: MemberUser;
  assignees: MemberUser[];
  labels: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
};

type ApiPull = {
  id: string;
  title: string;
  status: 'OPEN' | 'CLOSED' | 'MERGED';
  createdAt: string;
  author: MemberUser;
  assignees: MemberUser[];
  labels: Array<{
    id: string;
    name: string;
    color?: string;
  }>;
};

const VIEW_TABS: Array<TabItem<ViewMode>> = [
  { key: 'list', label: 'List view' },
  { key: 'board', label: 'Board view' },
];

const LANE_ORDER: TaskLane[] = ['BACKLOG', 'IN_PROGRESS', 'REVIEW', 'DONE'];

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'OPEN', label: 'Open only' },
  { value: 'ALL', label: 'All statuses' },
];

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'ALL', label: 'All types' },
  { value: 'ISSUE', label: 'Issues' },
  { value: 'PULL', label: 'Pull requests' },
];

const ASSIGNEE_OPTIONS: Array<{ value: AssigneeFilter; label: string }> = [
  { value: 'ALL', label: 'All assignees' },
  { value: 'MINE', label: 'My tasks' },
  { value: 'UNASSIGNED', label: 'Unassigned' },
];

const LANE_OPTIONS: Array<{ value: LaneFilter; label: string }> = [
  { value: 'ALL', label: 'All columns' },
  { value: 'BACKLOG', label: 'Backlog' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'DONE', label: 'Done' },
];

function parseScope(input: string | null): TaskScope {
  if (input === 'workspace' || input === 'repo') {
    return input;
  }
  return 'global';
}

function parseView(input: string | null): ViewMode {
  return input === 'board' ? 'board' : 'list';
}

function labelForLane(lane: TaskLane) {
  if (lane === 'IN_PROGRESS') {
    return 'In progress';
  }
  if (lane === 'DONE') {
    return 'Done';
  }
  return lane.charAt(0) + lane.slice(1).toLowerCase();
}

function toneForLane(lane: TaskLane): 'neutral' | 'accent' | 'warning' | 'success' {
  if (lane === 'BACKLOG') {
    return 'neutral';
  }
  if (lane === 'IN_PROGRESS') {
    return 'accent';
  }
  if (lane === 'REVIEW') {
    return 'warning';
  }
  return 'success';
}

function toneForType(type: TaskItem['type']): 'accent' | 'warning' {
  return type === 'ISSUE' ? 'accent' : 'warning';
}

function roleCanWrite(role: TaskItem['viewerRole']) {
  return role === 'WRITE' || role === 'ADMIN';
}

function buildTaskHref(item: TaskItem) {
  if (item.type === 'ISSUE') {
    return `/workspaces/${item.workspaceSlug}/repos/${item.repoSlug}/issues/${item.id}`;
  }
  return `/workspaces/${item.workspaceSlug}/repos/${item.repoSlug}/pulls/${item.id}`;
}

function authorLabel(user: MemberUser | undefined) {
  if (!user) {
    return 'Unknown';
  }
  return user.name ?? user.username ?? user.email;
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '-';
  }
  return parsed.toLocaleString();
}

function mergeReviewLabel(labels: Array<{ id: string; name: string; color?: string }>, enable: boolean) {
  const next = labels.map((label) => label.name);
  const hasReview = next.some((name) => name.toLowerCase().includes('review'));
  if (enable && !hasReview) {
    next.push('needs-review');
  }
  if (!enable && hasReview) {
    return next.filter((name) => !name.toLowerCase().includes('review'));
  }
  return next;
}

function mapIssueToTask(issue: ApiIssue, context: TaskRepoContext): TaskItem {
  const labels = issue.labels ?? [];
  return {
    id: issue.id,
    type: 'ISSUE',
    status: issue.status,
    lane: deriveTaskLane({
      type: 'ISSUE',
      status: issue.status,
      assignees: issue.assignees ?? [],
      labels,
    }),
    title: issue.title,
    createdAt: issue.createdAt,
    authorLabel: authorLabel(issue.author),
    author: issue.author,
    assignees: issue.assignees ?? [],
    labels,
    workspaceId: context.workspaceId,
    workspaceName: context.workspaceName,
    workspaceSlug: context.workspaceSlug,
    repoId: context.repoId,
    repoName: context.repoName,
    repoSlug: context.repoSlug,
    viewerRole: context.viewerRole,
  };
}

function mapPullToTask(pull: ApiPull, context: TaskRepoContext): TaskItem {
  const labels = pull.labels ?? [];
  return {
    id: pull.id,
    type: 'PULL',
    status: pull.status,
    lane: deriveTaskLane({
      type: 'PULL',
      status: pull.status,
      assignees: pull.assignees ?? [],
      labels,
    }),
    title: pull.title,
    createdAt: pull.createdAt,
    authorLabel: authorLabel(pull.author),
    author: pull.author,
    assignees: pull.assignees ?? [],
    labels,
    workspaceId: context.workspaceId,
    workspaceName: context.workspaceName,
    workspaceSlug: context.workspaceSlug,
    repoId: context.repoId,
    repoName: context.repoName,
    repoSlug: context.repoSlug,
    viewerRole: context.viewerRole,
  };
}

export default function TasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  const scope = parseScope(searchParams.get('scope'));
  const workspaceRef = (searchParams.get('workspaceId') ?? '').trim() || undefined;
  const repoRef = (searchParams.get('repoId') ?? '').trim() || undefined;
  const initialQuery = searchParams.get('q') ?? '';

  const [items, setItems] = useState<TaskItem[]>([]);
  const [repoOptions, setRepoOptions] = useState<TaskRepoContext[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isForbidden, setIsForbidden] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [isPartialData, setIsPartialData] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('ALL');
  const [laneFilter, setLaneFilter] = useState<LaneFilter>('ALL');
  const [query, setQuery] = useState(initialQuery);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [membersByWorkspace, setMembersByWorkspace] = useState<Record<string, MemberUser[]>>({});
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [toastStatus, setToastStatus] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createLane, setCreateLane] = useState<TaskLane>('BACKLOG');
  const [createRepoId, setCreateRepoId] = useState('');
  const [createAssigneeId, setCreateAssigneeId] = useState('');
  const [createValidation, setCreateValidation] = useState<string | null>(null);
  const [manageItem, setManageItem] = useState<TaskItem | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragLaneTarget, setDragLaneTarget] = useState<TaskLane | null>(null);

  const updateUrl = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value) {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }
      const queryString = next.toString();
      router.replace(queryString ? `/tasks?${queryString}` : '/tasks');
    },
    [router, searchParams],
  );

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (
      scope !== 'global' ||
      workspaceRef ||
      repoRef ||
      typeFilter !== 'ALL' ||
      laneFilter !== 'ALL' ||
      assigneeFilter !== 'ALL' ||
      statusFilter !== 'OPEN'
    ) {
      setShowAdvancedFilters(true);
    }
  }, [assigneeFilter, laneFilter, repoRef, scope, statusFilter, typeFilter, workspaceRef]);

  useEffect(() => {
    if (!getToken()) {
      setViewerId(null);
      return;
    }
    const loadViewer = async () => {
      try {
        const data = await apiFetch<{ user: { id: string } }>('/me', {
          suppressAuthRedirect: true,
        });
        setViewerId(data.user.id);
      } catch {
        setViewerId(null);
      }
    };
    void loadViewer();
  }, []);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setNeedsSignIn(false);
      setIsForbidden(false);
      setIsPartialData(false);
      setToastError(null);
      try {
        const result = await fetchTaskItems({
          statusFilter,
          scope,
          workspaceRef,
          repoRef,
        });
        setItems(result.items);
        setRepoOptions(result.repoOptions);
        setIsPartialData(result.access.partial);
        if (result.access.authRequired && !result.items.length) {
          setNeedsSignIn(true);
        }
        if (result.access.forbidden && !result.items.length) {
          setIsForbidden(true);
        }
      } catch (error) {
        if (error instanceof ApiRequestError) {
          if (error.status === 401) {
            setNeedsSignIn(true);
            setToastError('Sign in is required to load tasks.');
          } else if (error.status === 403) {
            setIsForbidden(true);
            setToastError('You do not have access to these tasks.');
          } else {
            setToastError(error.message);
          }
        } else {
          setToastError(error instanceof Error ? error.message : 'Unable to load tasks.');
        }
        setItems([]);
        setRepoOptions([]);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [repoRef, refreshTick, scope, statusFilter, workspaceRef]);

  const ensureMembers = useCallback(async (workspaceId: string) => {
    if (!workspaceId || membersByWorkspace[workspaceId]) {
      return;
    }
    try {
      const data = await apiFetch<{ members: WorkspaceMember[] }>(
        `/workspaces/${workspaceId}/members`,
        { suppressAuthRedirect: true },
      );
      setMembersByWorkspace((previous) => ({
        ...previous,
        [workspaceId]: data.members.map((entry) => entry.user),
      }));
    } catch {
      setMembersByWorkspace((previous) => ({
        ...previous,
        [workspaceId]: [],
      }));
    }
  }, [membersByWorkspace]);

  const writableRepos = useMemo(
    () => repoOptions.filter((context) => roleCanWrite(context.viewerRole)),
    [repoOptions],
  );

  useEffect(() => {
    if (!isCreateOpen) {
      return;
    }
    if (scope === 'repo') {
      const match =
        repoOptions.find((context) => context.repoId === repoRef || context.repoSlug === repoRef) ??
        null;
      if (match) {
        setCreateRepoId(match.repoId);
        void ensureMembers(match.workspaceId);
      }
      return;
    }
    if (!createRepoId && writableRepos.length) {
      setCreateRepoId(writableRepos[0].repoId);
      void ensureMembers(writableRepos[0].workspaceId);
    }
  }, [createRepoId, ensureMembers, isCreateOpen, repoOptions, repoRef, scope, writableRepos]);

  const selectedCreateRepo = useMemo(
    () => repoOptions.find((context) => context.repoId === createRepoId) ?? null,
    [createRepoId, repoOptions],
  );

  const selectedMembers = useMemo(
    () =>
      selectedCreateRepo
        ? membersByWorkspace[selectedCreateRepo.workspaceId] ?? []
        : [],
    [membersByWorkspace, selectedCreateRepo],
  );

  const filteredItems = useMemo(() => {
    const queryValue = query.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'ALL' && item.type !== typeFilter) {
        return false;
      }
      if (laneFilter !== 'ALL' && item.lane !== laneFilter) {
        return false;
      }
      if (assigneeFilter === 'MINE') {
        if (!viewerId || !item.assignees.some((assignee) => assignee.id === viewerId)) {
          return false;
        }
      } else if (assigneeFilter === 'UNASSIGNED' && item.assignees.length) {
        return false;
      }
      if (!queryValue) {
        return true;
      }
      const assigneeMatch = item.assignees.some((assignee) =>
        authorLabel(assignee).toLowerCase().includes(queryValue),
      );
      const labelMatch = item.labels.some((label) => label.name.toLowerCase().includes(queryValue));
      return (
        item.title.toLowerCase().includes(queryValue) ||
        item.workspaceName.toLowerCase().includes(queryValue) ||
        item.repoName.toLowerCase().includes(queryValue) ||
        item.authorLabel.toLowerCase().includes(queryValue) ||
        assigneeMatch ||
        labelMatch
      );
    });
  }, [assigneeFilter, items, laneFilter, query, typeFilter, viewerId]);

  const boardItems = useMemo(() => {
    const grouped: Record<TaskLane, TaskItem[]> = {
      BACKLOG: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };
    for (const item of filteredItems) {
      grouped[item.lane].push(item);
    }
    return grouped;
  }, [filteredItems]);

  const activeFilterPills = useMemo(() => {
    const pills: string[] = [];
    if (statusFilter !== 'OPEN') {
      pills.push('All statuses');
    }
    if (typeFilter !== 'ALL') {
      pills.push(`Type: ${TYPE_OPTIONS.find((option) => option.value === typeFilter)?.label ?? typeFilter}`);
    }
    if (assigneeFilter !== 'ALL') {
      pills.push(ASSIGNEE_OPTIONS.find((option) => option.value === assigneeFilter)?.label ?? assigneeFilter);
    }
    if (laneFilter !== 'ALL') {
      pills.push(`Column: ${labelForLane(laneFilter)}`);
    }
    if (scope !== 'global') {
      pills.push(`Scope: ${scope === 'repo' ? 'Repository' : 'Workspace'}`);
    }
    if (workspaceRef) {
      const workspaceLabel = repoOptions.find((context) => context.workspaceId === workspaceRef || context.workspaceSlug === workspaceRef)?.workspaceName;
      pills.push(`Workspace: ${workspaceLabel ?? 'Selected'}`);
    }
    if (repoRef) {
      const repoLabel = repoOptions.find((context) => context.repoId === repoRef || context.repoSlug === repoRef)?.repoName;
      pills.push(`Repository: ${repoLabel ?? 'Selected'}`);
    }
    return pills;
  }, [assigneeFilter, laneFilter, repoOptions, repoRef, scope, statusFilter, typeFilter, workspaceRef]);

  const openIssueCount = useMemo(
    () => filteredItems.filter((item) => item.type === 'ISSUE' && item.status === 'OPEN').length,
    [filteredItems],
  );

  const openPullCount = useMemo(
    () => filteredItems.filter((item) => item.type === 'PULL' && item.status === 'OPEN').length,
    [filteredItems],
  );

  const updateTaskInState = useCallback((nextItem: TaskItem) => {
    setItems((previous) =>
      previous.map((entry) => (entry.type === nextItem.type && entry.id === nextItem.id ? nextItem : entry)),
    );
  }, []);

  const applyLaneChange = async (item: TaskItem, nextLane: TaskLane) => {
    if (!roleCanWrite(item.viewerRole)) {
      setToastError('Write access is required to update this task.');
      return;
    }

    const context: TaskRepoContext = {
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      workspaceSlug: item.workspaceSlug,
      repoId: item.repoId,
      repoName: item.repoName,
      repoSlug: item.repoSlug,
      viewerRole: item.viewerRole,
    };

    setSavingItemId(`${item.type}:${item.id}:lane`);
    setToastError(null);
    try {
      if (item.type === 'ISSUE') {
        const nextStatus: ApiIssue['status'] = nextLane === 'DONE' ? 'CLOSED' : 'OPEN';
        let assigneeIds = item.assignees.map((assignee) => assignee.id);
        if (nextLane === 'BACKLOG') {
          assigneeIds = [];
        } else if (nextLane === 'IN_PROGRESS' && !assigneeIds.length && viewerId) {
          assigneeIds = [viewerId];
        }
        const labels = mergeReviewLabel(item.labels, nextLane === 'REVIEW');

        const data = await apiFetch<{ issue: ApiIssue }>(
          `/workspaces/${item.workspaceId}/repos/${item.repoId}/issues/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              status: nextStatus,
              assigneeIds,
              labels,
            }),
            suppressAuthRedirect: true,
          },
        );
        updateTaskInState(mapIssueToTask(data.issue, context));
      } else {
        const nextStatus: ApiPull['status'] = nextLane === 'DONE' ? 'CLOSED' : 'OPEN';
        const data = await apiFetch<{ pull: ApiPull }>(
          `/workspaces/${item.workspaceId}/repos/${item.repoId}/pulls/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              status: nextStatus,
            }),
            suppressAuthRedirect: true,
          },
        );
        updateTaskInState(mapPullToTask(data.pull, context));
      }
      setToastStatus(`Moved "${item.title}" to ${labelForLane(nextLane)}.`);
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setToastError(error instanceof Error ? error.message : 'Unable to update task status.');
    } finally {
      setSavingItemId(null);
    }
  };

  const applyAssigneeChange = async (item: TaskItem, userId: string | null) => {
    if (!roleCanWrite(item.viewerRole)) {
      setToastError('Write access is required to assign tasks.');
      return;
    }

    const context: TaskRepoContext = {
      workspaceId: item.workspaceId,
      workspaceName: item.workspaceName,
      workspaceSlug: item.workspaceSlug,
      repoId: item.repoId,
      repoName: item.repoName,
      repoSlug: item.repoSlug,
      viewerRole: item.viewerRole,
    };

    setSavingItemId(`${item.type}:${item.id}:assignee`);
    setToastError(null);
    try {
      if (item.type === 'ISSUE') {
        const data = await apiFetch<{ issue: ApiIssue }>(
          `/workspaces/${item.workspaceId}/repos/${item.repoId}/issues/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              assigneeIds: userId ? [userId] : [],
            }),
            suppressAuthRedirect: true,
          },
        );
        updateTaskInState(mapIssueToTask(data.issue, context));
      } else {
        const data = await apiFetch<{ pull: ApiPull }>(
          `/workspaces/${item.workspaceId}/repos/${item.repoId}/pulls/${item.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              assigneeIds: userId ? [userId] : [],
            }),
            suppressAuthRedirect: true,
          },
        );
        updateTaskInState(mapPullToTask(data.pull, context));
      }
      setToastStatus(userId ? 'Task assignee updated.' : 'Task unassigned.');
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setToastError(error instanceof Error ? error.message : 'Unable to update assignee.');
    } finally {
      setSavingItemId(null);
    }
  };

  const handleBoardDragStart = (item: TaskItem) => {
    if (!roleCanWrite(item.viewerRole)) {
      return;
    }
    setDragState({
      itemKey: `${item.type}:${item.id}`,
      lane: item.lane,
    });
    setDragLaneTarget(item.lane);
  };

  const handleBoardDrop = (lane: TaskLane) => {
    if (!dragState) {
      return;
    }
    const item = filteredItems.find((entry) => `${entry.type}:${entry.id}` === dragState.itemKey);
    setDragLaneTarget(null);
    setDragState(null);
    if (!item || lane === item.lane) {
      return;
    }
    void applyLaneChange(item, lane);
  };

  const clearFilters = () => {
    setQuery('');
    setStatusFilter('OPEN');
    setTypeFilter('ALL');
    setAssigneeFilter('ALL');
    setLaneFilter('ALL');
    setShowAdvancedFilters(false);
    updateUrl({
      scope: null,
      workspaceId: null,
      repoId: null,
      q: null,
    });
  };

  const createTask = async () => {
    if (!createTitle.trim()) {
      setCreateValidation('Task title is required.');
      return;
    }
    if (!selectedCreateRepo) {
      setCreateValidation('Select a repository for this task.');
      return;
    }
    if (!roleCanWrite(selectedCreateRepo.viewerRole)) {
      setCreateValidation('Write access is required for the selected repository.');
      return;
    }

    setCreateValidation(null);
    setIsCreating(true);
    setToastError(null);
    try {
      const labels = createLane === 'REVIEW' ? ['needs-review'] : [];
      const assigneeIds =
        createAssigneeId
          ? [createAssigneeId]
          : createLane === 'IN_PROGRESS' && viewerId
            ? [viewerId]
            : [];

      const created = await apiFetch<{ issue: ApiIssue }>(
        `/workspaces/${selectedCreateRepo.workspaceId}/repos/${selectedCreateRepo.repoId}/issues`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: createTitle.trim(),
            body: createDescription.trim() || undefined,
            assigneeIds: assigneeIds.length ? assigneeIds : undefined,
            labels: labels.length ? labels : undefined,
          }),
          suppressAuthRedirect: true,
        },
      );

      let issue = created.issue;
      if (createLane === 'DONE') {
        const updated = await apiFetch<{ issue: ApiIssue }>(
          `/workspaces/${selectedCreateRepo.workspaceId}/repos/${selectedCreateRepo.repoId}/issues/${issue.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'CLOSED' }),
            suppressAuthRedirect: true,
          },
        );
        issue = updated.issue;
      }

      setItems((previous) => [mapIssueToTask(issue, selectedCreateRepo), ...previous]);
      setToastStatus('Task created.');
      setCreateTitle('');
      setCreateDescription('');
      setCreateAssigneeId('');
      setCreateLane('BACKLOG');
      setIsCreateOpen(false);
      setRefreshTick((current) => current + 1);
    } catch (error) {
      setToastError(error instanceof Error ? error.message : 'Unable to create task.');
    } finally {
      setIsCreating(false);
    }
  };

  const renderTaskActions = (item: TaskItem) => {
    const canWrite = roleCanWrite(item.viewerRole);

    return (
      <div className="tasks-exec-actions">
        <Button variant="ghost" size="sm" href={buildTaskHref(item)}>
          Open
        </Button>
        {canWrite ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void ensureMembers(item.workspaceId);
              setManageItem(item);
            }}
          >
            Manage
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <AppShell title="Tasks">
      {toastError ? <PortalToast message={toastError} tone="error" onClose={() => setToastError(null)} /> : null}
      {toastStatus ? <PortalToast message={toastStatus} tone="success" onClose={() => setToastStatus(null)} /> : null}

      <div className="portal-page inbox-shell tasks-exec-shell portal-container">
        <Card className="portal-card tasks-exec-head">
          <SectionHeader
            title="Tasks"
            subtitle="Execution board linked to real issues and pull requests."
            actions={
              <InlineFormRow align="end">
                <Button
                  variant={assigneeFilter === 'MINE' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setAssigneeFilter((current) => (current === 'MINE' ? 'ALL' : 'MINE'))}
                >
                  My tasks
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!writableRepos.length}
                  onClick={() => setIsCreateOpen(true)}
                >
                  Create task
                </Button>
              </InlineFormRow>
            }
          />
          <div className="tasks-exec-metrics">
            <article>
              <span>Visible tasks</span>
              <strong>{filteredItems.length}</strong>
            </article>
            <article>
              <span>Open issues</span>
              <strong>{openIssueCount}</strong>
            </article>
            <article>
              <span>Open pull requests</span>
              <strong>{openPullCount}</strong>
            </article>
          </div>
          {isPartialData ? (
            <p className="muted">Some repositories could not be loaded due to access restrictions.</p>
          ) : null}
        </Card>

        <Card className="portal-card tasks-exec-filters">
          <SectionHeader
            title="Task flow"
            subtitle="Keep the everyday filters up front and tuck the heavy scoping controls away."
            actions={
              <InlineFormRow align="end" className="tasks-exec-filter-actions">
                <Button
                  className={`tasks-exec-filter-toggle ${showAdvancedFilters ? 'is-active' : ''}`}
                  variant={showAdvancedFilters ? 'secondary' : 'ghost'}
                  size="sm"
                  type="button"
                  aria-label={showAdvancedFilters ? 'Hide filters' : 'Show filters'}
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                >
                  <span className="tasks-exec-filter-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8">
                      <path d="M4 7h16" />
                      <path d="M7 12h10" />
                      <path d="M10 17h4" />
                    </svg>
                  </span>
                </Button>
                <Tabs
                  ariaLabel="Tasks view"
                  items={VIEW_TABS}
                  activeKey={view}
                  onChange={(next) => updateUrl({ view: next === 'list' ? null : next })}
                />
              </InlineFormRow>
            }
          />
          {showAdvancedFilters ? (
            <>
              <div className="tasks-exec-filter-toolbar">
                <div className="tasks-exec-filter-grid tasks-exec-filter-grid--quick">
                  <label>
                    Status
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Assignee
                    <select
                      value={assigneeFilter}
                      onChange={(event) => setAssigneeFilter(event.target.value as AssigneeFilter)}
                    >
                      {ASSIGNEE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}>
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {activeFilterPills.length ? (
                <div className="tasks-exec-active-filters">
                  {activeFilterPills.map((pill) => (
                    <span key={pill} className="tasks-exec-filter-pill">
                      {pill}
                    </span>
                  ))}
                  <button type="button" className="tasks-exec-filter-reset" onClick={clearFilters}>
                    Clear all
                  </button>
                </div>
              ) : null}

              <div className="tasks-exec-filter-grid tasks-exec-filter-grid--advanced">
                <label>
                  Scope
                  <select
                    value={scope}
                    onChange={(event) => {
                      const nextScope = event.target.value as TaskScope;
                      updateUrl({
                        scope: nextScope === 'global' ? null : nextScope,
                        workspaceId: nextScope === 'global' ? null : workspaceRef ?? null,
                        repoId: nextScope === 'repo' ? repoRef ?? null : null,
                      });
                    }}
                  >
                    <option value="global">Global</option>
                    <option value="workspace">Workspace</option>
                    <option value="repo">Repository</option>
                  </select>
                </label>
                <label>
                  Workspace
                  <select
                    value={workspaceRef ?? ''}
                    disabled={scope === 'global'}
                    onChange={(event) => {
                      const nextWorkspace = event.target.value || null;
                      updateUrl({
                        workspaceId: nextWorkspace,
                        repoId: scope === 'repo' ? null : undefined,
                      });
                    }}
                  >
                    <option value="">All workspaces</option>
                    {Array.from(new Set(repoOptions.map((context) => context.workspaceId))).map((workspaceIdValue) => {
                      const context = repoOptions.find((entry) => entry.workspaceId === workspaceIdValue);
                      if (!context) {
                        return null;
                      }
                      return (
                        <option key={workspaceIdValue} value={workspaceIdValue}>
                          {context.workspaceName}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Repository
                  <select
                    value={repoRef ?? ''}
                    disabled={scope !== 'repo'}
                    onChange={(event) => {
                      updateUrl({ repoId: event.target.value || null });
                    }}
                  >
                    <option value="">All repositories</option>
                    {repoOptions
                      .filter((context) => !workspaceRef || context.workspaceId === workspaceRef || context.workspaceSlug === workspaceRef)
                      .map((context) => (
                        <option key={context.repoId} value={context.repoId}>
                          {context.workspaceName} / {context.repoName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Column
                  <select value={laneFilter} onChange={(event) => setLaneFilter(event.target.value as LaneFilter)}>
                    {LANE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : null}
        </Card>

        {isLoading ? (
          <Card className="portal-card">
            <SkeletonLines count={6} />
          </Card>
        ) : needsSignIn ? (
          <Card className="portal-card stack">
            <p className="muted">Sign in to view tasks.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href={`/login?from=${encodeURIComponent('/tasks')}`}>
                Sign in
              </Button>
            </InlineFormRow>
          </Card>
        ) : isForbidden ? (
          <Card className="portal-card stack">
            <p className="muted">You are signed in but do not have permission to view these tasks.</p>
          </Card>
        ) : view === 'board' ? (
          <section className="tasks-exec-board">
            {LANE_ORDER.filter((lane) => laneFilter === 'ALL' || laneFilter === lane).map((lane) => (
              <Card
                key={lane}
                className={`portal-card tasks-exec-column ${dragLaneTarget === lane ? 'is-drop-target' : ''}`}
              >
                <header className="tasks-exec-column-head">
                  <strong>{labelForLane(lane)}</strong>
                  <Badge tone={toneForLane(lane)} size="sm">
                    {boardItems[lane].length}
                  </Badge>
                </header>
                <div
                  className="tasks-exec-column-list"
                  onDragOver={(event) => {
                    if (!dragState) {
                      return;
                    }
                    event.preventDefault();
                    if (dragLaneTarget !== lane) {
                      setDragLaneTarget(lane);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragLaneTarget === lane) {
                      setDragLaneTarget(null);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleBoardDrop(lane);
                  }}
                >
                  {boardItems[lane].length ? (
                    boardItems[lane].map((item) => (
                      <article
                        key={`${item.type}:${item.id}`}
                        className={`tasks-exec-task-card ${dragState?.itemKey === `${item.type}:${item.id}` ? 'is-dragging' : ''}`}
                        draggable={roleCanWrite(item.viewerRole)}
                        onDragStart={() => handleBoardDragStart(item)}
                        onDragEnd={() => {
                          setDragLaneTarget(null);
                          setDragState(null);
                        }}
                      >
                        <div className="tasks-exec-task-head">
                          <Link href={buildTaskHref(item)}>{item.title}</Link>
                          <Badge tone={toneForType(item.type)} size="sm">
                            {item.type === 'ISSUE' ? 'Issue' : 'PR'}
                          </Badge>
                        </div>
                        <p className="muted">
                          {item.workspaceName} / {item.repoName}
                        </p>
                        <p className="muted tasks-exec-linked">
                          {item.type === 'ISSUE' ? 'Linked issue' : 'Linked pull request'}:{' '}
                          <Link href={buildTaskHref(item)}>#{item.id.slice(0, 8)}</Link>
                        </p>
                        <p className="muted">Assignee: {item.assignees[0] ? authorLabel(item.assignees[0]) : 'Unassigned'}</p>
                        {roleCanWrite(item.viewerRole) ? (
                          <span className="tasks-exec-drag-note">Drag to move between columns</span>
                        ) : null}
                        <div className="tasks-exec-task-foot">
                          <Badge tone={toneForLane(item.lane)} size="sm">
                            {labelForLane(item.lane)}
                          </Badge>
                          {renderTaskActions(item)}
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className={`tasks-exec-empty-drop ${dragLaneTarget === lane ? 'is-drop-target' : ''}`}>
                      <EmptyState title="No tasks" description={`No tasks currently in ${labelForLane(lane)}.`} />
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </section>
        ) : filteredItems.length ? (
          <Card className="portal-card tasks-exec-list">
            <Table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Repository</th>
                  <th>Type</th>
                  <th>Column</th>
                  <th>Assignee</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={`${item.type}:${item.id}`}>
                    <td>
                      <Link className="tasks-exec-title-link" href={buildTaskHref(item)}>
                        {item.title}
                      </Link>
                      <p className="muted tasks-exec-linked-row">
                        {item.type === 'ISSUE' ? 'Issue' : 'Pull request'} #{item.id.slice(0, 8)}
                      </p>
                    </td>
                    <td>
                      <span className="tasks-exec-repo-cell">
                        <span>{item.workspaceName}</span>
                        <span>{item.repoName}</span>
                      </span>
                    </td>
                    <td>
                      <Badge tone={toneForType(item.type)} size="sm">
                        {item.type === 'ISSUE' ? 'Issue' : 'PR'}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={toneForLane(item.lane)} size="sm">
                        {labelForLane(item.lane)}
                      </Badge>
                    </td>
                    <td>{item.assignees[0] ? authorLabel(item.assignees[0]) : 'Unassigned'}</td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{renderTaskActions(item)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Card className="portal-card">
            <EmptyState
              title="No tasks found"
              description="Try changing your filters, or create a new task from an issue."
              action={
                writableRepos.length ? (
                  <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
                    Create task
                  </Button>
                ) : undefined
              }
            />
          </Card>
        )}
      </div>

      <Modal
        open={Boolean(manageItem)}
        onClose={() => {
          if (!savingItemId) {
            setManageItem(null);
          }
        }}
        title={manageItem ? `Manage: ${manageItem.title}` : 'Manage task'}
        subtitle={manageItem ? `${manageItem.workspaceName} / ${manageItem.repoName}` : 'Update task lane or assignee.'}
        closeLabel="Close manage task dialog"
        panelClassName="tasks-exec-manage-modal"
      >
        {manageItem ? (
          <div className="tasks-exec-manage-shell">
            <div className="tasks-exec-manage-group">
              <strong className="tasks-exec-manage-heading">Move to</strong>
              <div className="tasks-exec-manage-options">
                {(manageItem.type === 'PULL' ? (['REVIEW', 'DONE'] as TaskLane[]) : LANE_ORDER).map((lane) => (
                  <button
                    key={`${manageItem.id}-${lane}`}
                    type="button"
                    className={`tasks-exec-manage-option ${manageItem.lane === lane ? 'is-active' : ''}`}
                    disabled={(savingItemId?.startsWith(`${manageItem.type}:${manageItem.id}:`) ?? false) || manageItem.lane === lane}
                    onClick={() => {
                      void applyLaneChange(manageItem, lane);
                    }}
                  >
                    <span>{labelForLane(lane)}</span>
                    <small>{manageItem.lane === lane ? 'Current' : 'Move here'}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="tasks-exec-manage-group">
              <strong className="tasks-exec-manage-heading">Assign to</strong>
              <div className="tasks-exec-manage-options">
                <button
                  type="button"
                  className={`tasks-exec-manage-option ${manageItem.assignees.length ? '' : 'is-active'}`}
                  disabled={Boolean(savingItemId?.startsWith(`${manageItem.type}:${manageItem.id}:`))}
                  onClick={() => {
                    void applyAssigneeChange(manageItem, null);
                  }}
                >
                  <span>Unassigned</span>
                  <small>Remove current assignee</small>
                </button>
                {(membersByWorkspace[manageItem.workspaceId] ?? []).slice(0, 12).map((user) => (
                  <button
                    key={`${manageItem.id}-${user.id}`}
                    type="button"
                    className={`tasks-exec-manage-option ${manageItem.assignees.some((assignee) => assignee.id === user.id) ? 'is-active' : ''}`}
                    disabled={Boolean(savingItemId?.startsWith(`${manageItem.type}:${manageItem.id}:`))}
                    onClick={() => {
                      void applyAssigneeChange(manageItem, user.id);
                    }}
                  >
                    <span>{authorLabel(user)}</span>
                    <small>{user.username ? `@${user.username}` : user.email}</small>
                  </button>
                ))}
                {!(membersByWorkspace[manageItem.workspaceId] ?? []).length ? (
                  <p className="muted tasks-exec-menu-muted">No members found in this workspace.</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={isCreateOpen}
        onClose={() => {
          if (!isCreating) {
            setIsCreateOpen(false);
            setCreateValidation(null);
          }
        }}
        title="Create task"
        subtitle="Creates an issue-backed task that appears in board and list views."
        footer={
          <InlineFormRow align="start">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (!isCreating) {
                  setIsCreateOpen(false);
                }
              }}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void createTask()} disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create task'}
            </Button>
          </InlineFormRow>
        }
      >
        {createValidation ? <p className="muted">{createValidation}</p> : null}
        <label className="tasks-exec-form-field">
          Title
          <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
        </label>
        <label className="tasks-exec-form-field">
          Description
          <textarea
            rows={4}
            value={createDescription}
            onChange={(event) => setCreateDescription(event.target.value)}
          />
        </label>
        <label className="tasks-exec-form-field">
          Status lane
          <select value={createLane} onChange={(event) => setCreateLane(event.target.value as TaskLane)}>
            {LANE_ORDER.map((lane) => (
              <option key={lane} value={lane}>
                {labelForLane(lane)}
              </option>
            ))}
          </select>
        </label>
        <label className="tasks-exec-form-field">
          Repository
          <select
            value={createRepoId}
            onChange={(event) => {
              const nextRepoId = event.target.value;
              setCreateRepoId(nextRepoId);
              const match = repoOptions.find((context) => context.repoId === nextRepoId);
              if (match) {
                void ensureMembers(match.workspaceId);
              }
            }}
          >
            <option value="">Select repository</option>
            {writableRepos.map((context) => (
              <option key={context.repoId} value={context.repoId}>
                {context.workspaceName} / {context.repoName}
              </option>
            ))}
          </select>
        </label>
        <label className="tasks-exec-form-field">
          Assignee
          <select value={createAssigneeId} onChange={(event) => setCreateAssigneeId(event.target.value)}>
            <option value="">Unassigned</option>
            {selectedMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {authorLabel(member)}
              </option>
            ))}
          </select>
        </label>
      </Modal>
    </AppShell>
  );
}
