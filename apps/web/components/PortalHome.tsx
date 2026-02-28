'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { AppShell } from './AppShell';
import { apiFetch } from '../lib/api';
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from '../lib/workspace';
import { PortalToast } from './PortalToast';

type Workspace = { id: string; name: string; isPersonal?: boolean };
type RepoVisibility = 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
type PinnedRepo = {
  id: string;
  name: string;
  defaultBranch: string;
  visibility: RepoVisibility;
  workspaceId: string;
  workspaceName: string;
  pinnedAt: string;
  starsCount: number;
  forksCount: number;
  viewsCount: number;
};
type WorkItem = {
  id: string;
  type: 'ISSUE' | 'PULL';
  title: string;
  createdAt: string;
  authorLabel: string;
  workspaceId: string;
  repoId: string;
  repoName: string;
  assigneeIds: string[];
};
type CommitItem = {
  sha: string;
  message: string;
  author: string;
  date: string;
  workspaceId: string;
  repoId: string;
  repoName: string;
};
type ActivityItem = {
  id: string;
  type: 'commit' | 'pull' | 'issue';
  actor: string;
  subject: string;
  at: string;
  repoName: string;
  href: string;
};
type WorkScope = 'assigned' | 'all';
type WorkTab = 'pulls' | 'issues' | 'review';
type ActivityFilter = 'all' | 'commit' | 'pull' | 'issue';

const COMMIT_LIMIT = 40;

function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className}>
      {children}
    </svg>
  );
}
const IconPull = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="2.2" />
    <circle cx="17" cy="17" r="2.2" />
    <path d="M7 9.5v7.5" />
    <path d="M17 14V7" />
    <path d="M17 7h-5" />
  </Icon>
);
const IconIssue = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v5" />
    <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);
const IconCommit = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="7" cy="7" r="2.2" />
    <circle cx="17" cy="7" r="2.2" />
    <circle cx="12" cy="17" r="2.2" />
    <path d="M9.2 8.2l1.6 6.6" />
    <path d="M14.8 8.2l-1.6 6.6" />
  </Icon>
);
const IconStar = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 4l2.2 4.4 4.8.7-3.5 3.4.8 4.8L12 15.6 7.7 17.3l.8-4.8L5 9.1l4.8-.7z" />
  </Icon>
);
const IconPin = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M9 4.5h6v3.6l2.2 2.2v1.1H6.8v-1.1L9 8.1z" />
    <path d="M12 11.4V19.5" />
  </Icon>
);
const IconBranch = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="7" cy="6.5" r="1.8" />
    <circle cx="17" cy="6.5" r="1.8" />
    <circle cx="12" cy="17.5" r="1.8" />
    <path d="M7 8.3v2.2c0 2 1.6 3.6 3.6 3.6H12" />
    <path d="M17 8.3v2.2c0 2-1.6 3.6-3.6 3.6H12" />
  </Icon>
);
const IconEye = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M2.8 12s3.3-5 9.2-5 9.2 5 9.2 5-3.3 5-9.2 5-9.2-5-9.2-5z" />
    <circle cx="12" cy="12" r="2.4" />
  </Icon>
);

const activityVisual = (type: ActivityItem['type']) => {
  if (type === 'pull') {
    return {
      icon: IconPull,
      color: 'var(--home-blue)',
      bg: 'var(--home-blue-soft)',
    } as const;
  }
  if (type === 'issue') {
    return {
      icon: IconIssue,
      color: 'var(--home-amber)',
      bg: 'var(--home-amber-soft)',
    } as const;
  }
  return {
    icon: IconCommit,
    color: 'var(--home-green)',
    bg: 'var(--home-green-soft)',
  } as const;
};

const formatRelative = (value: string) => {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(delta / (1000 * 60)));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString();
};
const sanitizeBranchDisplay = (value: string | null | undefined) => {
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
};

export function PortalHome({ initialView }: { initialView?: string } = {}) {
  const isActivityView = initialView === 'activity';
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerLabel, setViewerLabel] = useState('there');
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [pinnedRepos, setPinnedRepos] = useState<PinnedRepo[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [reviewByPullId, setReviewByPullId] = useState<Record<string, string[]>>({});
  const [workScope, setWorkScope] = useState<WorkScope>('all');
  const [workTab, setWorkTab] = useState<WorkTab>('pulls');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [pinUpdating, setPinUpdating] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        try {
          const me = await apiFetch<{ user: { id: string; name?: string | null; username?: string | null; email?: string | null } }>('/me');
          setViewerId(me.user.id);
          setViewerLabel(me.user.name ?? me.user.username ?? me.user.email ?? 'there');
        } catch {
          setViewerId(null);
          setViewerLabel('there');
        }

        const ws = await apiFetch<{ workspaces: Workspace[] }>('/workspaces');
        if (!ws.workspaces.length) return;
        const selected = getSelectedWorkspaceId();
        const current =
          (selected ? ws.workspaces.find((w) => w.id === selected) : null) ??
          ws.workspaces.find((w) => w.isPersonal) ??
          ws.workspaces[0];
        setActiveWorkspace(current);
        setSelectedWorkspaceId(current.id);

        const reposData = await apiFetch<{ repos: Array<{ id: string; name: string; defaultBranch: string; visibility: RepoVisibility }> }>(
          `/workspaces/${current.id}/repos`,
        );

        const repos = reposData.repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
          defaultBranch: sanitizeBranchDisplay(repo.defaultBranch),
          visibility: repo.visibility,
          workspaceId: current.id,
          workspaceName: current.name,
        }));

        const pinnedData = await apiFetch<{
          pinned: Array<{
            pinnedAt: string;
            repo: {
              id: string;
              workspaceId: string;
              name: string;
              defaultBranch: string;
              visibility: RepoVisibility;
              starsCount: number;
              forksCount: number;
              viewsCount: number;
              workspace: { name: string };
            };
          }>;
        }>('/me/pinned-repos');

        setPinnedRepos(
          pinnedData.pinned
            .map((entry) => ({
              id: entry.repo.id,
              name: entry.repo.name,
              defaultBranch: sanitizeBranchDisplay(entry.repo.defaultBranch),
              visibility: entry.repo.visibility,
              workspaceId: entry.repo.workspaceId,
              workspaceName: entry.repo.workspace.name,
              pinnedAt: entry.pinnedAt,
              starsCount: entry.repo.starsCount,
              forksCount: entry.repo.forksCount,
              viewsCount: entry.repo.viewsCount,
            }))
            .filter((repo) => repo.workspaceId === current.id),
        );

        const workResult = await Promise.allSettled(
          repos.map(async (repo) => {
            const [issuesData, pullsData] = await Promise.all([
              apiFetch<{ issues: Array<{ id: string; title: string; createdAt: string; author: { name?: string | null; email: string }; assignees: Array<{ id: string }> }> }>(
                `/workspaces/${repo.workspaceId}/repos/${repo.id}/issues?status=OPEN`,
              ),
              apiFetch<{ pulls: Array<{ id: string; title: string; createdAt: string; author: { name?: string | null; email: string }; assignees: Array<{ id: string }> }> }>(
                `/workspaces/${repo.workspaceId}/repos/${repo.id}/pulls?status=OPEN`,
              ),
            ]);
            return [
              ...issuesData.issues.map((issue) => ({
                id: issue.id,
                type: 'ISSUE' as const,
                title: issue.title,
                createdAt: issue.createdAt,
                authorLabel: issue.author.name ?? issue.author.email,
                workspaceId: repo.workspaceId,
                repoId: repo.id,
                repoName: repo.name,
                assigneeIds: issue.assignees.map((a) => a.id),
              })),
              ...pullsData.pulls.map((pull) => ({
                id: pull.id,
                type: 'PULL' as const,
                title: pull.title,
                createdAt: pull.createdAt,
                authorLabel: pull.author.name ?? pull.author.email,
                workspaceId: repo.workspaceId,
                repoId: repo.id,
                repoName: repo.name,
                assigneeIds: pull.assignees.map((a) => a.id),
              })),
            ];
          }),
        );

        const merged = workResult
          .filter((r): r is PromiseFulfilledResult<WorkItem[]> => r.status === 'fulfilled')
          .flatMap((r) => r.value);
        setWorkItems(merged);

        const pulls = merged.filter((item) => item.type === 'PULL');
        const reviewResult = await Promise.allSettled(
          pulls.map((pull) =>
            apiFetch<{ reviewRequests: Array<{ reviewer: { id: string } }> }>(
              `/workspaces/${pull.workspaceId}/repos/${pull.repoId}/pulls/${pull.id}/review-requests`,
            ),
          ),
        );
        const reviewMap: Record<string, string[]> = {};
        reviewResult.forEach((r, i) => {
          if (r.status === 'fulfilled') reviewMap[pulls[i].id] = r.value.reviewRequests.map((x) => x.reviewer.id);
        });
        setReviewByPullId(reviewMap);

        const commitResult = await Promise.allSettled(
          repos.map(async (repo) => {
            const data = await apiFetch<{ commits: Array<{ sha: string; message: string; author: string; date: string }> }>(
              `/workspaces/${repo.workspaceId}/repos/${repo.id}/commits?branch=${repo.defaultBranch}&limit=${COMMIT_LIMIT}`,
            );
            return data.commits.map((c) => ({
              sha: c.sha,
              message: c.message,
              author: c.author,
              date: c.date,
              workspaceId: repo.workspaceId,
              repoId: repo.id,
              repoName: repo.name,
            }));
          }),
        );
        setCommits(
          commitResult
            .filter((r): r is PromiseFulfilledResult<CommitItem[]> => r.status === 'fulfilled')
            .flatMap((r) => r.value),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load overview.');
      } finally {
        setIsLoading(false);
      }
    };
    void run();
  }, []);

  const openPulls = useMemo(() => workItems.filter((x) => x.type === 'PULL'), [workItems]);
  const openIssues = useMemo(() => workItems.filter((x) => x.type === 'ISSUE'), [workItems]);
  const assignedCount = useMemo(() => (viewerId ? workItems.filter((x) => x.assigneeIds.includes(viewerId)).length : 0), [viewerId, workItems]);
  const reviewCount = useMemo(
    () => (viewerId ? openPulls.filter((p) => (reviewByPullId[p.id] ?? []).includes(viewerId)).length : 0),
    [viewerId, openPulls, reviewByPullId],
  );
  const starsCount = useMemo(() => pinnedRepos.reduce((sum, repo) => sum + repo.starsCount, 0), [pinnedRepos]);

  const latestCommitByRepo = useMemo(() => {
    const map: Record<string, CommitItem> = {};
    for (const c of commits) {
      if (!map[c.repoId] || new Date(c.date).getTime() > new Date(map[c.repoId].date).getTime()) map[c.repoId] = c;
    }
    return map;
  }, [commits]);

  const allActivity = useMemo<ActivityItem[]>(() => {
    const commitItems: ActivityItem[] = commits.map((c) => ({
      id: `commit-${c.repoId}-${c.sha}`,
      type: 'commit',
      actor: c.author,
      subject: c.message,
      at: c.date,
      repoName: c.repoName,
      href: `/workspaces/${c.workspaceId}/repos/${c.repoId}`,
    }));
    const workActivity: ActivityItem[] = workItems.map((item) => ({
      id: `${item.type}-${item.repoId}-${item.id}`,
      type: item.type === 'PULL' ? 'pull' : 'issue',
      actor: item.authorLabel,
      subject: item.title,
      at: item.createdAt,
      repoName: item.repoName,
        href:
          item.type === 'PULL'
            ? `/workspaces/${item.workspaceId}/repos/${item.repoId}/pulls/${item.id}`
            : `/workspaces/${item.workspaceId}/repos/${item.repoId}/issues/${item.id}`,
    }));
    return [...commitItems, ...workActivity].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [commits, workItems]);

  const filteredActivity = useMemo(
    () => (activityFilter === 'all' ? allActivity : allActivity.filter((a) => a.type === activityFilter)),
    [allActivity, activityFilter],
  );

  const scopedWork = useMemo(() => {
    const source = workScope === 'assigned' && viewerId ? workItems.filter((x) => x.assigneeIds.includes(viewerId)) : workItems;
    const filtered =
      workTab === 'pulls'
        ? source.filter((x) => x.type === 'PULL')
        : workTab === 'issues'
          ? source.filter((x) => x.type === 'ISSUE')
          : source.filter((x) => x.type === 'PULL' && !!viewerId && (reviewByPullId[x.id] ?? []).includes(viewerId));
    return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
  }, [viewerId, workItems, workScope, workTab, reviewByPullId]);

  const scopedCounts = useMemo(() => {
    const source = workScope === 'assigned' && viewerId ? workItems.filter((x) => x.assigneeIds.includes(viewerId)) : workItems;
    return {
      pulls: source.filter((x) => x.type === 'PULL').length,
      issues: source.filter((x) => x.type === 'ISSUE').length,
      review: source.filter((x) => x.type === 'PULL' && !!viewerId && (reviewByPullId[x.id] ?? []).includes(viewerId)).length,
    };
  }, [viewerId, workItems, workScope, reviewByPullId]);

  const workCountsByRepo = useMemo(() => {
    const next = new Map<string, { issues: number; pulls: number }>();
    for (const item of workItems) {
      const current = next.get(item.repoId) ?? { issues: 0, pulls: 0 };
      if (item.type === 'PULL') {
        current.pulls += 1;
      } else {
        current.issues += 1;
      }
      next.set(item.repoId, current);
    }
    return next;
  }, [workItems]);
  const commitCountsByRepo = useMemo(() => {
    const next = new Map<string, number>();
    for (const commit of commits) {
      next.set(commit.repoId, (next.get(commit.repoId) ?? 0) + 1);
    }
    return next;
  }, [commits]);

  const heatmap = useMemo(() => {
    const days = 84;
    const byDay = new Map<string, number>();
    for (const c of commits) {
      const key = new Date(c.date).toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    const now = new Date();
    const cells: Array<{ key: string; level: 0 | 1 | 2 | 3 | 4; count: number }> = [];
    let total = 0;
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const count = byDay.get(key) ?? 0;
      total += count;
      const level: 0 | 1 | 2 | 3 | 4 = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
      cells.push({ key, level, count });
    }
    return { cells, total };
  }, [commits]);

  const stats = [
    { label: 'Active PRs', value: openPulls.length, icon: IconPull, color: 'var(--home-blue)', soft: 'var(--home-blue-soft)' },
    { label: 'Open Issues', value: openIssues.length, icon: IconIssue, color: 'var(--home-amber)', soft: 'var(--home-amber-soft)' },
    { label: 'Commits', value: commits.length, icon: IconCommit, color: 'var(--home-green)', soft: 'var(--home-green-soft)' },
    { label: 'Stars Earned', value: starsCount, icon: IconStar, color: 'var(--home-purple)', soft: 'var(--home-purple-soft)' },
  ] as const;

  const unpin = async (repo: PinnedRepo) => {
    setPinUpdating(repo.id);
    try {
      await apiFetch(`/workspaces/${repo.workspaceId}/repos/${repo.id}/pin`, { method: 'DELETE' });
      setPinnedRepos((prev) => prev.filter((x) => x.id !== repo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update pin state.');
    } finally {
      setPinUpdating(null);
    }
  };

  const activityFilters: Array<{ key: ActivityFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'commit', label: 'Commits' },
    { key: 'pull', label: 'Pull requests' },
    { key: 'issue', label: 'Issues' },
  ];

  if (isActivityView) {
    return (
      <AppShell title="Activity">
        <div className="home-wrap">
          {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
          <section className="home-card">
            <div className="home-activity-header">
              <div className="home-activity-copy">
                <h1 className="home-title">Activity</h1>
                <p className="home-subtitle home-activity-subtitle">
                  Track commits, pull requests, and issues across repositories.
                </p>
              </div>
              <div className="home-tabs home-tabs--activity">
                {activityFilters.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    className={`home-tab ${activityFilter === f.key ? 'active' : ''}`}
                    onClick={() => setActivityFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <p className="home-muted">Loading activity...</p>
            ) : filteredActivity.length === 0 ? (
              <div className="home-empty">No activity found for this filter.</div>
            ) : (
              <div className="home-list">
                {filteredActivity.map((a) => (
                  <article key={a.id} className="home-item">
                    <span
                      className="home-item-icon"
                      style={
                        {
                          '--item-color': a.type === 'commit' ? 'var(--home-green)' : a.type === 'pull' ? 'var(--home-blue)' : 'var(--home-amber)',
                          '--item-bg': a.type === 'commit' ? 'var(--home-green-soft)' : a.type === 'pull' ? 'var(--home-blue-soft)' : 'var(--home-amber-soft)',
                        } as CSSProperties
                      }
                    >
                      {a.type === 'commit' ? <IconCommit className="home-icon" /> : a.type === 'pull' ? <IconPull className="home-icon" /> : <IconIssue className="home-icon" />}
                    </span>
                    <div className="home-item-body">
                      <div className="home-item-title">{a.actor} in {a.repoName}</div>
                      <div className="home-item-meta">{a.subject} - {formatRelative(a.at)}</div>
                    </div>
                    <Link className="home-item-link" href={a.href}>Open</Link>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Home">
      <div className="home-wrap">
        {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}

        <section className="home-card home-hero-panel">
          <div className="home-hero">
            <div className="home-hero-text">
              <h1 className="home-title">Welcome back, {viewerLabel}</h1>
              <p className="home-subtitle">Here&apos;s what&apos;s happening with your projects today.</p>
            </div>
          </div>
          <section className="home-stat-grid" aria-label="Overview metrics">
            {stats.map((stat) => (
              <article
                key={stat.label}
                className="home-stat-card"
                style={{ '--stat-color': stat.color, '--stat-bg': stat.soft } as CSSProperties}
              >
                <span className="home-stat-icon"><stat.icon className="home-icon" /></span>
                <div className="home-stat-value">{stat.value}</div>
                <div className="home-stat-label">{stat.label}</div>
              </article>
            ))}
          </section>
        </section>

        <section className="home-card home-section">
          <div className="home-section-header">
            <div>
              <h2 className="home-section-title">Pinned repositories</h2>
              <p className="home-section-subtitle">Your most important repositories, ready to resume.</p>
            </div>
            <Link className="home-link" href="/repositories">Manage</Link>
          </div>

          {isLoading ? (
            <p className="home-muted">Loading pinned repositories...</p>
          ) : pinnedRepos.length === 0 ? (
            <div className="home-empty">No pinned repositories yet. Pin from any repository header.</div>
          ) : (
            <div className="home-pinned-grid">
              {pinnedRepos.map((repo) => {
                const updatedAt = latestCommitByRepo[repo.id]?.date ?? repo.pinnedAt;
                const repoCounts = workCountsByRepo.get(repo.id) ?? { issues: 0, pulls: 0 };
                const commitCount = commitCountsByRepo.get(repo.id) ?? 0;
                return (
                  <article key={repo.id} className="home-pinned-card home-pinned-card-v2">
                    <div className="home-pinned-main">
                      <div className="home-pinned-top-v2">
                        <div className="home-item-title home-pinned-title-v2">
                          {repo.workspaceName}/{repo.name}
                        </div>
                        <button
                          type="button"
                          className="home-pin-button home-pin-button-card home-pin-button-card-v2"
                          disabled={pinUpdating === repo.id}
                          onClick={() => void unpin(repo)}
                          aria-label="Unpin repository"
                          title="Unpin"
                        >
                          <IconPin className="home-icon-sm" />
                        </button>
                      </div>
                      <div className="home-item-meta home-pinned-headline home-pinned-headline-v2">
                        <span className={`home-repo-pill home-repo-pill-${repo.visibility.toLowerCase()}`}>
                          {repo.visibility}
                        </span>
                        <span className="home-repo-pill home-repo-pill-branch">
                          <IconBranch className="home-icon-sm" />
                          <span>default: {repo.defaultBranch}</span>
                        </span>
                        <span className="home-repo-pill home-repo-pill-date">{formatRelative(updatedAt)}</span>
                      </div>
                    </div>
                    <div className="home-pinned-footer-v2">
                      <div className="home-pinned-meta home-pinned-meta-v2" aria-label="Repository stats">
                        <span className="home-pinned-meta-item">
                          <IconIssue className="home-icon-sm" />
                          <span>{repoCounts.issues}</span>
                        </span>
                        <span className="home-pinned-meta-item">
                          <IconPull className="home-icon-sm" />
                          <span>{repoCounts.pulls}</span>
                        </span>
                        <span className="home-pinned-meta-item">
                          <IconCommit className="home-icon-sm" />
                          <span>{commitCount}</span>
                        </span>
                        <span className="home-pinned-meta-item">
                          <IconEye className="home-icon-sm" />
                          <span>{repo.viewsCount}</span>
                        </span>
                        <span className="home-pinned-meta-item">
                          <IconStar className="home-icon-sm" />
                          <span>{repo.starsCount}</span>
                        </span>
                      </div>
                      <Link
                        className="home-item-link home-pinned-open home-pinned-open-v2"
                        href={`/workspaces/${repo.workspaceId}/repos/${repo.id}`}
                      >
                        Open
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <div className="home-grid">
          <section className="home-card home-work">
            <div className="home-work-header">
              <div>
                <h2 className="home-section-title">Your work</h2>
                <p className="home-section-subtitle">Focus on what needs attention.</p>
              </div>
              <div className="home-toggle">
                <button type="button" className={`home-toggle-btn ${workScope === 'assigned' ? 'active' : ''}`} onClick={() => setWorkScope('assigned')}>Assigned to me</button>
                <button type="button" className={`home-toggle-btn ${workScope === 'all' ? 'active' : ''}`} onClick={() => setWorkScope('all')}>All open</button>
              </div>
            </div>

            <div className="home-tabs">
              <button type="button" className={`home-tab ${workTab === 'pulls' ? 'active' : ''}`} onClick={() => setWorkTab('pulls')}>Pull Requests <span className="home-tab-count">{scopedCounts.pulls}</span></button>
              <button type="button" className={`home-tab ${workTab === 'issues' ? 'active' : ''}`} onClick={() => setWorkTab('issues')}>Issues <span className="home-tab-count">{scopedCounts.issues}</span></button>
              <button type="button" className={`home-tab ${workTab === 'review' ? 'active' : ''}`} onClick={() => setWorkTab('review')}>Needs Review <span className="home-tab-count">{scopedCounts.review}</span></button>
            </div>

            {isLoading ? (
              <p className="home-muted">Loading work items...</p>
            ) : scopedWork.length === 0 ? (
              <div className="home-empty">{workTab === 'pulls' ? 'No pull requests right now.' : workTab === 'issues' ? 'No issues right now.' : 'No review requests right now.'}</div>
            ) : (
              <div className="home-list">
                {scopedWork.map((item) => (
                  <article key={`${item.type}-${item.id}`} className="home-item">
                    <span className="home-item-icon" style={{ '--item-color': item.type === 'PULL' ? 'var(--home-blue)' : 'var(--home-amber)', '--item-bg': item.type === 'PULL' ? 'var(--home-blue-soft)' : 'var(--home-amber-soft)' } as CSSProperties}>
                      {item.type === 'PULL' ? <IconPull className="home-icon" /> : <IconIssue className="home-icon" />}
                    </span>
                    <div className="home-item-body">
                      <div className="home-item-title">{item.title}</div>
                      <div className="home-item-meta">{item.repoName} - {formatRelative(item.createdAt)}</div>
                    </div>
                    <Link
                      className="home-item-link"
                      href={
                        item.type === 'PULL'
                          ? `/workspaces/${item.workspaceId}/repos/${item.repoId}/pulls/${item.id}`
                          : `/workspaces/${item.workspaceId}/repos/${item.repoId}/issues/${item.id}`
                      }
                    >
                      Open
                    </Link>
                  </article>
                ))}
              </div>
            )}

            <div className="home-work-footer">
              <span className="home-muted">Showing {workTab === 'pulls' ? 'pull requests' : workTab === 'issues' ? 'issues' : 'review queue'}</span>
              <Link className="home-link" href={workTab === 'issues' ? '/issues' : '/pulls'}>View all</Link>
            </div>
          </section>

          <aside className="home-side">
            <section className="home-card home-heatmap">
              <div className="home-section-header">
                <h2 className="home-section-title">Last 3 months</h2>
                <span className="home-muted">Contributions</span>
              </div>
              <div className="heatmap-grid" aria-hidden="true">
                {heatmap.cells.map((cell) => (<span key={cell.key} className="heatmap-cell" data-level={cell.level} title={`${cell.key}: ${cell.count} commit${cell.count === 1 ? "" : "s"}`} />))}
              </div>
              <div className="heatmap-legend">
                <span>Less</span>
                <span className="heatmap-legend-scale">
                  <span className="heatmap-cell" data-level={0} />
                  <span className="heatmap-cell" data-level={1} />
                  <span className="heatmap-cell" data-level={2} />
                  <span className="heatmap-cell" data-level={3} />
                  <span className="heatmap-cell" data-level={4} />
                </span>
                <span>More</span>
              </div>
              <p className="home-muted">{heatmap.total} contributions in the last 3 months.</p>
            </section>

            <section className="home-card home-activity">
              <div className="home-section-header">
                <h2 className="home-section-title">Recent activity</h2>
                <Link className="home-link" href="/activity">View all</Link>
              </div>
              {isLoading ? (
                <p className="home-muted">Loading activity...</p>
              ) : allActivity.length === 0 ? (
                <div className="home-empty">No recent activity.</div>
              ) : (
                <div className="home-activity-list">
                  {allActivity.slice(0, 5).map((a) => (
                    <Link key={a.id} href={a.href} className="home-activity-item">
                      <span
                        className="home-activity-icon"
                        style={
                          {
                            '--activity-color': activityVisual(a.type).color,
                            '--activity-bg': activityVisual(a.type).bg,
                          } as CSSProperties
                        }
                      >
                        {(() => {
                          const ActivityIcon = activityVisual(a.type).icon;
                          return <ActivityIcon className="home-icon-sm" />;
                        })()}
                      </span>
                      <div>
                        <div className="home-item-title">{a.repoName}</div>
                        <div className="home-item-meta">{a.subject} - {formatRelative(a.at)}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

