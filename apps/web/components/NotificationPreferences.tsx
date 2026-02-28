'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { getToken } from '../lib/auth';
import { PortalToast } from './PortalToast';

type NotificationPreferences = {
  id: string;
  userId: string;
  inAppActivityEnabled: boolean;
  mentionsEnabled: boolean;
  reviewRequestsEnabled: boolean;
  reviewSubmittedEnabled: boolean;
  issueCommentsEnabled: boolean;
  pullCommentsEnabled: boolean;
  pullStatusEnabled: boolean;
  systemEnabled: boolean;
  emailMentionsEnabled: boolean;
  emailReviewsEnabled: boolean;
  productUpdatesEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type PreferenceKey = keyof Omit<
  NotificationPreferences,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>;

type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
};

type RepoSummary = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
};

type RepoNotificationMode = 'DEFAULT' | 'WATCH' | 'MUTE';

type RepoNotificationPreferenceEntry = {
  id: string;
  mode: RepoNotificationMode;
  createdAt: string;
  updatedAt: string;
  repo: {
    id: string;
    name: string;
    slug: string;
    visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
    defaultBranch: string;
    workspaceId: string;
    workspace: {
      id: string;
      name: string;
      slug: string;
    };
  };
};

export function NotificationPreferences() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoModes, setRepoModes] = useState<Record<string, RepoNotificationMode>>(
    {},
  );
  const [savedRepoModes, setSavedRepoModes] = useState<
    Record<string, RepoNotificationMode>
  >({});
  const [repoQuery, setRepoQuery] = useState('');
  const [repoModeFilter, setRepoModeFilter] = useState<
    'ALL' | RepoNotificationMode
  >('ALL');
  const [bulkMode, setBulkMode] = useState<RepoNotificationMode>('DEFAULT');
  const [isLoadingRepoOverrides, setIsLoadingRepoOverrides] = useState(false);
  const [savingRepoId, setSavingRepoId] = useState<string | null>(null);
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const loadPreferences = useCallback(async () => {
    if (!hasToken) {
      setPreferences(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ preferences: NotificationPreferences }>(
        '/me/notification-preferences',
      );
      setPreferences(data.preferences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load preferences.');
    } finally {
      setIsLoading(false);
    }
  }, [hasToken]);

  const loadRepoOverrides = useCallback(async () => {
    if (!hasToken) {
      setRepos([]);
      setRepoModes({});
      setSavedRepoModes({});
      return;
    }

    setIsLoadingRepoOverrides(true);
    setError(null);
    try {
      const [workspaceData, preferenceData] = await Promise.all([
        apiFetch<{ workspaces: WorkspaceSummary[] }>('/workspaces'),
        apiFetch<{ preferences: RepoNotificationPreferenceEntry[] }>(
          '/me/repo-notification-preferences',
        ),
      ]);
      const repoResults = await Promise.all(
        workspaceData.workspaces.map(async (workspace) => {
          const data = await apiFetch<{
            repos: Array<{
              id: string;
              name: string;
              slug: string;
              visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
              defaultBranch: string;
            }>;
          }>(`/workspaces/${workspace.id}/repos`);
          return data.repos.map((repo) => ({
            ...repo,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
          }));
        }),
      );

      const list = repoResults
        .flat()
        .sort((left, right) => {
          const workspaceDelta = left.workspaceName.localeCompare(right.workspaceName);
          if (workspaceDelta !== 0) {
            return workspaceDelta;
          }
          return left.name.localeCompare(right.name);
        });
      const overrideMap = new Map(
        preferenceData.preferences.map((entry) => [entry.repo.id, entry.mode]),
      );
      const initialModes = Object.fromEntries(
        list.map((repo) => [repo.id, overrideMap.get(repo.id) ?? 'DEFAULT']),
      ) as Record<string, RepoNotificationMode>;

      setRepos(list);
      setRepoModes(initialModes);
      setSavedRepoModes(initialModes);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load repository overrides.',
      );
    } finally {
      setIsLoadingRepoOverrides(false);
    }
  }, [hasToken]);

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    void loadRepoOverrides();
  }, [loadRepoOverrides]);

  const setPreference = async (key: PreferenceKey, value: boolean) => {
    if (!preferences) {
      return;
    }
    setSavingKey(key);
    setError(null);
    setSuccess(null);

    const previous = preferences;
    const optimistic = { ...previous, [key]: value };
    setPreferences(optimistic);

    try {
      const data = await apiFetch<{ preferences: NotificationPreferences }>(
        '/me/notification-preferences',
        {
          method: 'PATCH',
          body: JSON.stringify({ [key]: value }),
        },
      );
      setPreferences(data.preferences);
      setSuccess('Preferences updated.');
    } catch (err) {
      setPreferences(previous);
      setError(err instanceof Error ? err.message : 'Unable to update preferences.');
    } finally {
      setSavingKey((current) => (current === key ? null : current));
    }
  };

  const saveRepoMode = async (repo: RepoSummary) => {
    const mode = repoModes[repo.id] ?? 'DEFAULT';
    setSavingRepoId(repo.id);
    setError(null);
    setSuccess(null);
    try {
      const data = await apiFetch<{
        preference: {
          mode: RepoNotificationMode;
        };
      }>(`/workspaces/${repo.workspaceId}/repos/${repo.id}/notification-preferences`, {
        method: 'PATCH',
        body: JSON.stringify({ mode }),
      });
      setRepoModes((prev) => ({ ...prev, [repo.id]: data.preference.mode }));
      setSavedRepoModes((prev) => ({ ...prev, [repo.id]: data.preference.mode }));
      setSuccess(`Saved notification mode for ${repo.name}.`);
    } catch (err) {
      setRepoModes((prev) => ({ ...prev, [repo.id]: savedRepoModes[repo.id] ?? 'DEFAULT' }));
      setError(err instanceof Error ? err.message : 'Unable to save repo mode.');
    } finally {
      setSavingRepoId((current) => (current === repo.id ? null : current));
    }
  };

  const filteredRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    return repos.filter((repo) => {
      if (
        repoModeFilter !== 'ALL' &&
        (repoModes[repo.id] ?? 'DEFAULT') !== repoModeFilter
      ) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack =
        `${repo.workspaceName} ${repo.workspaceSlug} ${repo.name} ${repo.slug}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [repoModeFilter, repoModes, repoQuery, repos]);

  const visibleRepos = useMemo(() => filteredRepos.slice(0, 80), [filteredRepos]);

  const changedVisibleRepos = useMemo(
    () =>
      visibleRepos.filter(
        (repo) =>
          (repoModes[repo.id] ?? 'DEFAULT') !==
          (savedRepoModes[repo.id] ?? 'DEFAULT'),
      ),
    [repoModes, savedRepoModes, visibleRepos],
  );
  const visibleModeSummary = useMemo(
    () =>
      visibleRepos.reduce(
        (acc, repo) => {
          const mode = repoModes[repo.id] ?? 'DEFAULT';
          acc[mode] += 1;
          return acc;
        },
        {
          DEFAULT: 0,
          WATCH: 0,
          MUTE: 0,
        } as Record<RepoNotificationMode, number>,
      ),
    [repoModes, visibleRepos],
  );

  const applyBulkModeToVisible = () => {
    if (!visibleRepos.length) {
      return;
    }
    setRepoModes((prev) => {
      const next = { ...prev };
      for (const repo of visibleRepos) {
        next[repo.id] = bulkMode;
      }
      return next;
    });
    setSuccess(`Applied ${bulkMode} mode to ${visibleRepos.length} visible repos.`);
    setError(null);
  };

  const saveVisibleRepoModes = async () => {
    if (!changedVisibleRepos.length) {
      return;
    }
    setIsSavingBulk(true);
    setError(null);
    setSuccess(null);
    const beforeSave = { ...savedRepoModes };

    const results = await Promise.allSettled(
      changedVisibleRepos.map(async (repo) => {
        const mode = repoModes[repo.id] ?? 'DEFAULT';
        await apiFetch(`/workspaces/${repo.workspaceId}/repos/${repo.id}/notification-preferences`, {
          method: 'PATCH',
          body: JSON.stringify({ mode }),
        });
        return { repoId: repo.id, mode };
      }),
    );

    const successful: Array<{ repoId: string; mode: RepoNotificationMode }> = [];
    const failedRepoIds: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        const reason = result.reason;
        if (reason instanceof Error) {
          // keep first useful message surfaced
          setError((current) => current ?? reason.message);
        }
      }
    }

    const successfulIds = new Set(successful.map((entry) => entry.repoId));
    for (const repo of changedVisibleRepos) {
      if (!successfulIds.has(repo.id)) {
        failedRepoIds.push(repo.id);
      }
    }

    if (successful.length) {
      setSavedRepoModes((prev) => {
        const next = { ...prev };
        for (const entry of successful) {
          next[entry.repoId] = entry.mode;
        }
        return next;
      });
    }

    if (failedRepoIds.length) {
      setRepoModes((prev) => {
        const next = { ...prev };
        for (const repoId of failedRepoIds) {
          next[repoId] = beforeSave[repoId] ?? 'DEFAULT';
        }
        return next;
      });
      setError(
        (current) =>
          current ??
          `Saved ${successful.length} repositories, failed ${failedRepoIds.length}.`,
      );
    } else {
      setSuccess(`Saved notification mode for ${successful.length} repositories.`);
    }
    setIsSavingBulk(false);
  };

  return (
    <div className="stack">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {success ? <PortalToast message={success} tone="success" onClose={() => setSuccess(null)} /> : null}

      {!hasToken ? (
        <p className="muted inbox-empty">Sign in to manage notification preferences.</p>
      ) : isLoading || !preferences ? (
        <p className="muted inbox-state">Loading preferences...</p>
      ) : (
        <>
          <section className="card canvas-card">
            <div className="stack">
              <h2 className="canvas-title">Notification preferences</h2>
              <p className="canvas-subtitle">
                Choose exactly what appears in your in-app feed and alerts.
              </p>

              <label className="toggle-row">
                <span>
                  <strong>In-app activity feed</strong>
                  <span className="muted">
                    Master switch for all in-app notification items.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.inAppActivityEnabled}
                  onChange={(event) =>
                    void setPreference('inAppActivityEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'inAppActivityEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Mentions</strong>
                  <span className="muted">Notify when someone tags your username.</span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.mentionsEnabled}
                  onChange={(event) =>
                    void setPreference('mentionsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'mentionsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Review requests</strong>
                  <span className="muted">
                    Notify when a pull request requests your review.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.reviewRequestsEnabled}
                  onChange={(event) =>
                    void setPreference('reviewRequestsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'reviewRequestsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Review submissions</strong>
                  <span className="muted">
                    Notify when someone submits review feedback.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.reviewSubmittedEnabled}
                  onChange={(event) =>
                    void setPreference('reviewSubmittedEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'reviewSubmittedEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Issue comments</strong>
                  <span className="muted">
                    Notify for discussion updates on issues you touched.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.issueCommentsEnabled}
                  onChange={(event) =>
                    void setPreference('issueCommentsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'issueCommentsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Pull request comments</strong>
                  <span className="muted">
                    Notify for PR discussion and inline comment updates.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.pullCommentsEnabled}
                  onChange={(event) =>
                    void setPreference('pullCommentsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'pullCommentsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Pull request status changes</strong>
                  <span className="muted">
                    Notify when pull requests are closed, reopened, or merged.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.pullStatusEnabled}
                  onChange={(event) =>
                    void setPreference('pullStatusEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'pullStatusEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>System notices</strong>
                  <span className="muted">
                    Notify for admin and platform-level announcements.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.systemEnabled}
                  onChange={(event) =>
                    void setPreference('systemEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'systemEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Email for mentions</strong>
                  <span className="muted">
                    Enable email notifications when you are mentioned.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.emailMentionsEnabled}
                  onChange={(event) =>
                    void setPreference('emailMentionsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'emailMentionsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Email for review requests</strong>
                  <span className="muted">
                    Enable email notifications when review is requested.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.emailReviewsEnabled}
                  onChange={(event) =>
                    void setPreference('emailReviewsEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'emailReviewsEnabled'}
                />
              </label>

              <label className="toggle-row">
                <span>
                  <strong>Product announcements</strong>
                  <span className="muted">Opt in to occasional product updates.</span>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.productUpdatesEnabled}
                  onChange={(event) =>
                    void setPreference('productUpdatesEnabled', event.target.checked)
                  }
                  disabled={savingKey === 'productUpdatesEnabled'}
                />
              </label>
            </div>
          </section>

          <section className="card canvas-card repo-overrides">
            <div className="stack">
              <div>
                <h3 className="canvas-title">Repository overrides</h3>
                <p className="canvas-subtitle">
                  Set watch/mute behavior for specific repositories across all your workspaces.
                </p>
              </div>

              <div className="repo-overrides-controls">
                <label className="field">
                  <span>Search repositories</span>
                  <input
                    type="search"
                    placeholder="Search by workspace or repository"
                    value={repoQuery}
                    onChange={(event) => setRepoQuery(event.target.value)}
                  />
                </label>

                <div className="repo-overrides-filters">
                  <label className="field">
                    <span>Mode filter</span>
                    <select
                      value={repoModeFilter}
                      onChange={(event) =>
                        setRepoModeFilter(
                          event.target.value as 'ALL' | RepoNotificationMode,
                        )
                      }
                    >
                      <option value="ALL">All</option>
                      <option value="DEFAULT">Default</option>
                      <option value="WATCH">Watch</option>
                      <option value="MUTE">Mute</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Bulk mode for visible list</span>
                    <select
                      value={bulkMode}
                      onChange={(event) =>
                        setBulkMode(event.target.value as RepoNotificationMode)
                      }
                    >
                      <option value="DEFAULT">Default</option>
                      <option value="WATCH">Watch</option>
                      <option value="MUTE">Mute</option>
                    </select>
                  </label>
                </div>

                <div className="repo-overrides-actions">
                  <button
                    className="ghost small"
                    type="button"
                    onClick={applyBulkModeToVisible}
                    disabled={!visibleRepos.length || isSavingBulk}
                  >
                    Apply to visible ({visibleRepos.length})
                  </button>
                  <button
                    className="primary small"
                    type="button"
                    onClick={() => void saveVisibleRepoModes()}
                    disabled={!changedVisibleRepos.length || isSavingBulk}
                  >
                    {isSavingBulk
                      ? 'Saving...'
                      : `Save visible changes (${changedVisibleRepos.length})`}
                  </button>
                </div>
                <div className="repo-overrides-summary muted">
                  <span>Visible: {visibleRepos.length}</span>
                  <span>Default: {visibleModeSummary.DEFAULT}</span>
                  <span>Watch: {visibleModeSummary.WATCH}</span>
                  <span>Mute: {visibleModeSummary.MUTE}</span>
                  {changedVisibleRepos.length ? (
                    <span className="repo-overrides-unsaved">
                      Unsaved: {changedVisibleRepos.length}
                    </span>
                  ) : null}
                </div>
              </div>

              {isLoadingRepoOverrides ? (
                <p className="muted inbox-state">Loading repository overrides...</p>
              ) : visibleRepos.length ? (
                <ul className="repo-overrides-list">
                  {visibleRepos.map((repo) => {
                    const currentMode = repoModes[repo.id] ?? 'DEFAULT';
                    const savedMode = savedRepoModes[repo.id] ?? 'DEFAULT';
                    const isDirty = currentMode !== savedMode;
                    const isSaving = savingRepoId === repo.id;
                    return (
                      <li key={repo.id} className="repo-override-item">
                      <div className="repo-override-main">
                        <div className="repo-override-identity">
                          <strong>{repo.name}</strong>
                          <span className="muted">
                            {repo.workspaceName} - {repo.slug}
                          </span>
                        </div>
                        <div className="repo-override-meta">
                          <span className={`chip ${repo.visibility.toLowerCase()}`}>
                            {repo.visibility}
                          </span>
                          <span className="chip info">
                            mode {currentMode.toLowerCase()}
                          </span>
                          {isDirty ? <span className="chip muted">unsaved</span> : null}
                        </div>
                      </div>
                      <div className="repo-override-controls-inline">
                        <label className="field repo-override-mode-field">
                          <span>Mode</span>
                          <select
                            value={currentMode}
                            onChange={(event) =>
                              setRepoModes((prev) => ({
                                ...prev,
                                [repo.id]: event.target.value as RepoNotificationMode,
                              }))
                            }
                            disabled={isSaving || isSavingBulk}
                          >
                            <option value="DEFAULT">Default</option>
                            <option value="WATCH">Watch</option>
                            <option value="MUTE">Mute</option>
                          </select>
                        </label>
                        <span className="repo-override-status muted">
                          {isSaving ? 'Saving...' : isDirty ? 'Unsaved change' : 'Saved'}
                        </span>
                        <button
                          className="primary small"
                          type="button"
                          onClick={() => void saveRepoMode(repo)}
                          disabled={isSavingBulk || isSaving || !isDirty}
                        >
                          {isSaving ? 'Saving...' : 'Save mode'}
                        </button>
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() =>
                            setRepoModes((prev) => ({
                              ...prev,
                              [repo.id]: savedMode,
                            }))
                          }
                          disabled={isSavingBulk || isSaving || !isDirty}
                        >
                          Reset
                        </button>
                      </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="muted inbox-empty">No repositories found for this filter.</p>
              )}
              {filteredRepos.length > 80 ? (
                <p className="muted">Showing first 80 repositories.</p>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
