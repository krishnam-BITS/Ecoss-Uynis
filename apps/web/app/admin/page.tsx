'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { apiFetch, ApiRequestError } from '../../lib/api';

type AdminHealth = {
  readiness: {
    ok: boolean;
    checks: Record<string, { ok: boolean; message?: string }>;
  };
  totals: {
    users: number;
    workspaces: number;
    repos: number;
    pats: number;
    webhooks: number;
    importJobs: number;
  };
};

type AdminUser = {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  isVerified: boolean;
  createdAt: string;
};

type AdminWorkspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  createdAt: string;
};

type AdminRepo = {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  defaultBranch: string;
  workspaceId: string;
  createdAt: string;
};

type AdminPat = {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  user: {
    email: string | null;
    username: string | null;
  };
};

type AdminWebhook = {
  id: string;
  repoId: string;
  name: string;
  url: string;
  active: boolean;
  events: string[];
  lastDeliveryAt: string | null;
  createdAt: string;
};

type AdminImportJob = {
  id: string;
  repoId: string;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDate(value: string | null) {
  if (!value) {
    return '-';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleString('en-US', DATE_OPTIONS);
}

export default function AdminPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [repos, setRepos] = useState<AdminRepo[]>([]);
  const [pats, setPats] = useState<AdminPat[]>([]);
  const [webhooks, setWebhooks] = useState<AdminWebhook[]>([]);
  const [jobs, setJobs] = useState<AdminImportJob[]>([]);
  const [activeSection, setActiveSection] = useState<
    'users' | 'workspaces' | 'repos' | 'pats' | 'webhooks' | 'jobs'
  >('users');
  const [revokingPatId, setRevokingPatId] = useState<string | null>(null);

  const sectionButtons = useMemo(
    () => [
      { key: 'users', label: `Users (${users.length})` },
      { key: 'workspaces', label: `Workspaces (${workspaces.length})` },
      { key: 'repos', label: `Repos (${repos.length})` },
      { key: 'pats', label: `PATs (${pats.length})` },
      { key: 'webhooks', label: `Webhooks (${webhooks.length})` },
      { key: 'jobs', label: `Import jobs (${jobs.length})` },
    ],
    [jobs.length, pats.length, repos.length, users.length, webhooks.length, workspaces.length],
  );

  const loadAdminData = async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const [healthData, usersData, workspacesData, reposData, patsData, webhooksData, jobsData] =
        await Promise.all([
          apiFetch<AdminHealth>('/admin/health'),
          apiFetch<{ users: AdminUser[] }>('/admin/users?limit=50'),
          apiFetch<{ workspaces: AdminWorkspace[] }>('/admin/workspaces?limit=50'),
          apiFetch<{ repos: AdminRepo[] }>('/admin/repos?limit=50'),
          apiFetch<{ pats: AdminPat[] }>('/admin/pats?limit=50'),
          apiFetch<{ webhooks: AdminWebhook[] }>('/admin/webhooks?limit=50'),
          apiFetch<{ jobs: AdminImportJob[] }>('/admin/import-jobs?limit=50'),
        ]);

      setHealth(healthData);
      setUsers(usersData.users);
      setWorkspaces(workspacesData.workspaces);
      setRepos(reposData.repos);
      setPats(patsData.pats);
      setWebhooks(webhooksData.webhooks);
      setJobs(jobsData.jobs);
    } catch (nextError) {
      if (
        nextError instanceof ApiRequestError &&
        (nextError.status === 403 || nextError.status === 404)
      ) {
        setNotFound(true);
      } else {
        setError(nextError instanceof Error ? nextError.message : 'Unable to load admin data.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminData();
  }, []);

  const handleRevokePat = async (tokenId: string) => {
    setRevokingPatId(tokenId);
    try {
      await apiFetch(`/admin/pats/${tokenId}/revoke`, { method: 'POST' });
      setPats((current) =>
        current.map((token) =>
          token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
        ),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to revoke token.');
    } finally {
      setRevokingPatId(null);
    }
  };

  return (
    <AppShell title="Admin">
      <div className="inbox-shell">
        {notFound ? (
          <section className="card canvas-card">
            <h1 className="canvas-title">404</h1>
            <p className="canvas-subtitle">Page not found.</p>
          </section>
        ) : null}
        {!notFound ? (
        <section className="card canvas-card">
          <div className="row space-between">
            <div className="stack">
              <h1 className="canvas-title">Admin panel</h1>
              <p className="canvas-subtitle">
                System controls and audit visibility for users, workspaces, repos, tokens,
                webhooks, and import jobs.
              </p>
            </div>
            <button className="ghost small" type="button" onClick={() => void loadAdminData()}>
              Refresh
            </button>
          </div>
          {health ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <article className="workspace-summary-item">
                <span>Users</span>
                <strong>{health.totals.users}</strong>
              </article>
              <article className="workspace-summary-item">
                <span>Workspaces</span>
                <strong>{health.totals.workspaces}</strong>
              </article>
              <article className="workspace-summary-item">
                <span>Repos</span>
                <strong>{health.totals.repos}</strong>
              </article>
              <article className="workspace-summary-item">
                <span>PATs</span>
                <strong>{health.totals.pats}</strong>
              </article>
              <article className="workspace-summary-item">
                <span>Webhooks</span>
                <strong>{health.totals.webhooks}</strong>
              </article>
              <article className="workspace-summary-item">
                <span>Import jobs</span>
                <strong>{health.totals.importJobs}</strong>
              </article>
            </div>
          ) : null}
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {health
              ? Object.entries(health.readiness.checks).map(([name, check]) => (
                  <span
                    key={name}
                    className={`chip ${check.ok ? 'success' : 'muted'}`}
                    title={check.message ?? ''}
                  >
                    {name}: {check.ok ? 'ok' : 'down'}
                  </span>
                ))
              : null}
          </div>
        </section>
        ) : null}

        {!notFound ? (
        <section className="card canvas-card">
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {sectionButtons.map((section) => (
              <button
                key={section.key}
                className={`ghost small ${activeSection === section.key ? 'active' : ''}`}
                type="button"
                onClick={() =>
                  setActiveSection(
                    section.key as
                      | 'users'
                      | 'workspaces'
                      | 'repos'
                      | 'pats'
                      | 'webhooks'
                      | 'jobs',
                  )
                }
              >
                {section.label}
              </button>
            ))}
          </div>

          {isLoading ? <p className="muted">Loading admin data...</p> : null}
          {error ? <p className="error-text">{error}</p> : null}

          {!isLoading && !error && activeSection === 'users' ? (
            <ul className="list">
              {users.map((user) => (
                <li key={user.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{user.name || user.username || user.email || user.id}</strong>
                      <p className="muted">{user.email || 'No email'} • {user.username || 'No username'}</p>
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${user.isVerified ? 'success' : 'muted'}`}>
                        {user.isVerified ? 'verified' : 'unverified'}
                      </span>
                      <span className="muted">{formatDate(user.createdAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && !error && activeSection === 'workspaces' ? (
            <ul className="list">
              {workspaces.map((workspace) => (
                <li key={workspace.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{workspace.name}</strong>
                      <p className="muted">
                        {workspace.slug} • owner {workspace.ownerUserId ?? '-'}
                      </p>
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${workspace.isPersonal ? 'info' : ''}`}>
                        {workspace.isPersonal ? 'personal' : 'team'}
                      </span>
                      <span className="muted">{formatDate(workspace.createdAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && !error && activeSection === 'repos' ? (
            <ul className="list">
              {repos.map((repo) => (
                <li key={repo.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{repo.name}</strong>
                      <p className="muted">
                        {repo.slug} • {repo.defaultBranch} • workspace {repo.workspaceId}
                      </p>
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${repo.visibility === 'PUBLIC' ? 'public' : 'private'}`}>
                        {repo.visibility}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && !error && activeSection === 'pats' ? (
            <ul className="list">
              {pats.map((token) => (
                <li key={token.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{token.name}</strong>
                      <p className="muted">
                        {token.tokenPrefix} • {token.user.email || token.user.username || token.userId}
                      </p>
                      <p className="muted">Scopes: {token.scopes.join(', ') || 'none'}</p>
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${token.revokedAt ? 'muted' : 'success'}`}>
                        {token.revokedAt ? 'revoked' : 'active'}
                      </span>
                      <button
                        className="ghost small"
                        type="button"
                        disabled={Boolean(token.revokedAt) || revokingPatId === token.id}
                        onClick={() => void handleRevokePat(token.id)}
                      >
                        {token.revokedAt
                          ? 'Revoked'
                          : revokingPatId === token.id
                            ? 'Revoking...'
                            : 'Revoke'}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && !error && activeSection === 'webhooks' ? (
            <ul className="list">
              {webhooks.map((hook) => (
                <li key={hook.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{hook.name}</strong>
                      <p className="muted">{hook.url}</p>
                      <p className="muted">Repo: {hook.repoId} • {hook.events.join(', ') || 'all events'}</p>
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${hook.active ? 'success' : 'muted'}`}>
                        {hook.active ? 'active' : 'disabled'}
                      </span>
                      <span className="muted">Last: {formatDate(hook.lastDeliveryAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && !error && activeSection === 'jobs' ? (
            <ul className="list">
              {jobs.map((job) => (
                <li key={job.id} className="queue-item">
                  <div className="queue-main">
                    <div className="queue-content">
                      <strong>{job.type} import</strong>
                      <p className="muted">Repo: {job.repoId} • attempts {job.attempts}/{job.maxAttempts}</p>
                      {job.error ? <p className="muted">{job.error}</p> : null}
                    </div>
                    <div className="queue-actions">
                      <span className={`chip ${job.status === 'COMPLETED' ? 'success' : job.status === 'FAILED' ? 'muted' : 'info'}`}>
                        {job.status}
                      </span>
                      <span className="muted">{formatDate(job.updatedAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        ) : null}
      </div>
    </AppShell>
  );
}
