'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../../../../components/AppShell';
import { RepoHeader } from '../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../components/RepoNav';
import { PortalPage, PortalToolbar } from '../../../../../../components/portal';
import { PortalToast } from '../../../../../../components/PortalToast';
import { ApiRequestError, apiFetch } from '../../../../../../lib/api';
import { Button, Card, EmptyState, SkeletonLines } from '../../../../../../src/components/ui';

type Repo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  workspace?: {
    slug?: string;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

type Commit = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

type Issue = {
  id: string;
};

type Pull = {
  id: string;
};

function sanitizeBranchName(rawValue: string | null | undefined): string {
  const value = (rawValue ?? '').trim();
  if (!value) {
    return '';
  }
  const nullIndex = value.indexOf('\u0000');
  const withoutNull = nullIndex >= 0 ? value.slice(0, nullIndex) : value;
  const percentNoiseIndex = withoutNull.indexOf('%x');
  const cleaned = percentNoiseIndex > 0 ? withoutNull.slice(0, percentNoiseIndex) : withoutNull;
  return cleaned.trim();
}

function weekLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function RepoInsightsPage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const [repo, setRepo] = useState<Repo | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [openIssues, setOpenIssues] = useState(0);
  const [closedIssues, setClosedIssues] = useState(0);
  const [openPulls, setOpenPulls] = useState(0);
  const [closedPulls, setClosedPulls] = useState(0);
  const [mergedPulls, setMergedPulls] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!workspaceId || !repoId) {
      return;
    }

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setAuthRequired(false);
      setForbidden(false);
      try {
        const repoData = await apiFetch<{ repo: Repo }>(
          `/workspaces/${workspaceId}/repos/${repoId}`,
          { suppressAuthRedirect: true },
        );
        setRepo(repoData.repo);

        const branch = sanitizeBranchName(repoData.repo.defaultBranch) || 'main';
        const [
          commitData,
          issuesOpenData,
          issuesClosedData,
          pullsOpenData,
          pullsClosedData,
          pullsMergedData,
        ] = await Promise.all([
          apiFetch<{ commits: Commit[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/commits?branch=${encodeURIComponent(branch)}&limit=50`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ issues: Issue[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/issues?status=OPEN`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ issues: Issue[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/issues?status=CLOSED`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/pulls?status=OPEN`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/pulls?status=CLOSED`,
            { suppressAuthRedirect: true },
          ),
          apiFetch<{ pulls: Pull[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/pulls?status=MERGED`,
            { suppressAuthRedirect: true },
          ),
        ]);

        setCommits(commitData.commits);
        setOpenIssues(issuesOpenData.issues.length);
        setClosedIssues(issuesClosedData.issues.length);
        setOpenPulls(pullsOpenData.pulls.length);
        setClosedPulls(pullsClosedData.pulls.length);
        setMergedPulls(pullsMergedData.pulls.length);
      } catch (err) {
        if (err instanceof ApiRequestError) {
          if (err.status === 401) {
            setAuthRequired(true);
            setError('Sign in is required to read insights in this repository.');
          } else if (err.status === 403) {
            setForbidden(true);
            setError('You do not have permission to read this repository.');
          } else if (err.status === 404) {
            setError('Repository not found.');
          } else {
            setError(err.message);
          }
        } else {
          setError(err instanceof Error ? err.message : 'Unable to load repository insights.');
        }
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [repoId, workspaceId]);

  const repoWorkspaceRef = repo?.workspace?.slug ?? workspaceId;
  const repoRef = repo?.slug ?? repoId;

  const commitChart = useMemo(() => {
    const now = new Date();
    const weeks = Array.from({ length: 12 }).map((_, index) => {
      const start = new Date(now);
      start.setDate(now.getDate() - (11 - index) * 7);
      start.setHours(0, 0, 0, 0);
      return {
        key: start.toISOString(),
        label: weekLabel(start),
        count: 0,
        start,
      };
    });

    for (const commit of commits) {
      const commitDate = new Date(commit.date);
      const bucketIndex = weeks.findIndex((week, index) => {
        const next = weeks[index + 1];
        if (!next) {
          return commitDate >= week.start;
        }
        return commitDate >= week.start && commitDate < next.start;
      });
      if (bucketIndex >= 0) {
        weeks[bucketIndex].count += 1;
      }
    }

    const max = Math.max(1, ...weeks.map((week) => week.count));
    return {
      max,
      weeks: weeks.map((week) => ({
        ...week,
        height: Math.max(8, Math.round((week.count / max) * 90)),
      })),
    };
  }, [commits]);

  const topAuthors = useMemo(() => {
    const map = new Map<string, number>();
    for (const commit of commits) {
      map.set(commit.author, (map.get(commit.author) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6);
  }, [commits]);

  return (
    <AppShell title="Insights">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}

      <RepoHeader
        workspaceId={workspaceId}
        repoId={repoId}
        repo={repo}
        languages={repo?.languages ?? []}
      />
      <PortalPage className="repo-insights-shell">
        <RepoNav
          workspaceId={repoWorkspaceRef}
          repoId={repoRef}
          active="insights"
          viewerRole={repo?.viewerRole}
        />
        <PortalToolbar
          title="Insights"
          subtitle="Commit velocity and collaboration health for this repository."
        />

        {isLoading ? (
          <div className="portal-skeleton-grid">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={`insights-skeleton-${index}`} className="portal-card">
                <SkeletonLines count={3} />
              </Card>
            ))}
          </div>
        ) : authRequired ? (
          <Card className="portal-card stack">
            <p className="muted">
              This repository requires authentication before you can read insights.
            </p>
            <div className="row">
              <Button
                variant="primary"
                size="sm"
                href={`/login?from=${encodeURIComponent(`/workspaces/${workspaceId}/repos/${repoId}/insights`)}`}
              >
                Sign in
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </div>
          </Card>
        ) : forbidden ? (
          <Card className="portal-card stack">
            <p className="muted">You are signed in but do not have access to this repository.</p>
            <div className="row">
              <Button variant="primary" size="sm" href="/workspaces">
                Workspaces
              </Button>
              <Button variant="ghost" size="sm" href="/">
                Home
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <section className="repo-insights-grid">
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Commits (last 160)</span>
                <strong>{commits.length}</strong>
              </Card>
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Open issues</span>
                <strong>{openIssues}</strong>
              </Card>
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Closed issues</span>
                <strong>{closedIssues}</strong>
              </Card>
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Open pull requests</span>
                <strong>{openPulls}</strong>
              </Card>
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Merged pull requests</span>
                <strong>{mergedPulls}</strong>
              </Card>
              <Card className="canvas-card repo-insight-card">
                <span className="muted">Closed pull requests</span>
                <strong>{closedPulls}</strong>
              </Card>
            </section>

            <Card className="canvas-card repo-insight-chart">
              <div className="repo-insight-chart-head">
                <h3>Commit activity</h3>
                <p className="muted">Weekly commits on {repo?.defaultBranch ?? 'main'}</p>
              </div>
              <div className="repo-insight-bars" role="img" aria-label="Commit activity bars">
                {commitChart.weeks.map((week) => (
                  <div key={week.key} className="repo-insight-bar-item">
                    <span
                      className="repo-insight-bar"
                      style={{ height: `${week.height}px` }}
                      title={`${week.label}: ${week.count} commit${week.count === 1 ? '' : 's'}`}
                    />
                    <span className="repo-insight-bar-label">{week.label}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="canvas-card repo-insight-contributors">
              <div className="repo-insight-chart-head">
                <h3>Top contributors</h3>
                <p className="muted">Based on recent commits</p>
              </div>
              {topAuthors.length ? (
                <ul className="list repo-insight-contributor-list">
                  {topAuthors.map(([author, count]) => (
                    <li key={author} className="repo-insight-contributor-row">
                      <span>{author}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No commit data available yet." />
              )}
            </Card>
          </>
        )}
      </PortalPage>
    </AppShell>
  );
}

