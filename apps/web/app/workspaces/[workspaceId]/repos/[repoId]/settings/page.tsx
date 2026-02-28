'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../../../components/AppShell';
import { PortalToast } from '../../../../../../components/PortalToast';
import { RepoHeader } from '../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../components/RepoNav';
import { PortalCardSkeleton, PortalPage, PortalToolbar } from '../../../../../../components/portal';
import { apiFetch } from '../../../../../../lib/api';
import {
  RepoSettingsTabs,
  type RepoSettingsTabKey,
} from '../../../../../../src/components/settings/RepoSettingsTabs';
import { PatManagement } from '../../../../../../src/components/settings/PatManagement';
import { WebhookList } from '../../../../../../src/components/settings/WebhookList';
import { Button, Card, InlineFormRow, SectionHeader } from '../../../../../../src/components/ui';

type Repo = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  publicReadRequiresAuth?: boolean;
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  workspace?: {
    slug?: string;
    isPersonal?: boolean;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

type RepoNotificationPreference = {
  id: string | null;
  userId: string;
  repoId: string;
  mode: 'DEFAULT' | 'WATCH' | 'MUTE';
  createdAt: string | null;
  updatedAt: string | null;
};

type Tone = 'success' | 'error' | 'warning' | 'info';

const validTabs: RepoSettingsTabKey[] = ['general', 'access', 'webhooks', 'pats', 'danger'];

const formatRole = (role?: Repo['viewerRole']) => {
  if (!role) {
    return 'Unknown';
  }
  return role.charAt(0) + role.slice(1).toLowerCase();
};

const formatVisibility = (value: Repo['visibility']) => value.toLowerCase();

export default function RepoGeneralSettingsPage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tabParam = (searchParams.get('tab') ?? '').trim() as RepoSettingsTabKey;
  const activeTab = validTabs.includes(tabParam) ? tabParam : 'general';

  const [repo, setRepo] = useState<Repo | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [defaultBranch, setDefaultBranch] = useState('main');

  const [notificationMode, setNotificationMode] = useState<RepoNotificationPreference['mode']>('DEFAULT');

  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingGeneral, setIsSavingGeneral] = useState(false);
  const [isSavingNotifications, setIsSavingNotifications] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [isDeletingRepo, setIsDeletingRepo] = useState(false);
  const [isRepoDeleted, setIsRepoDeleted] = useState(false);

  const canAdmin = repo?.viewerRole === 'ADMIN';

  const notify = (message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
  };

  useEffect(() => {
    const load = async () => {
      if (!workspaceId || !repoId || isRepoDeleted) {
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const [repoData, notificationData] = await Promise.all([
          apiFetch<{ repo: Repo }>(`/workspaces/${workspaceId}/repos/${repoId}`),
          apiFetch<{ preference: RepoNotificationPreference }>(
            `/workspaces/${workspaceId}/repos/${repoId}/notification-preferences`,
          ),
        ]);

        const normalizedRepo: Repo = {
          ...repoData.repo,
          workspace: repoData.repo.workspace,
        };

        setRepo(normalizedRepo);
        setName(normalizedRepo.name);
        setSlug(normalizedRepo.slug);
        setDescription(normalizedRepo.description ?? '');
        setDefaultBranch(normalizedRepo.defaultBranch);
        setNotificationMode(notificationData.preference.mode);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load repository settings.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [workspaceId, repoId, isRepoDeleted]);

  const saveGeneral = async () => {
    if (!workspaceId || !repoId || !canAdmin) {
      return;
    }

    setIsSavingGeneral(true);
    try {
      const data = await apiFetch<{ repo: Repo }>(`/workspaces/${workspaceId}/repos/${repoId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
          defaultBranch: defaultBranch.trim(),
        }),
      });

      const updated = {
        ...data.repo,
        workspace: data.repo.workspace ?? repo?.workspace,
      } as Repo;
      setRepo(updated);
      setName(updated.name);
      setSlug(updated.slug);
      setDescription(updated.description ?? '');
      setDefaultBranch(updated.defaultBranch);
      notify('Repository settings saved.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to save repository settings.', 'error');
    } finally {
      setIsSavingGeneral(false);
    }
  };

  const saveNotificationMode = async () => {
    if (!workspaceId || !repoId) {
      return;
    }

    setIsSavingNotifications(true);
    try {
      const data = await apiFetch<{ preference: RepoNotificationPreference }>(
        `/workspaces/${workspaceId}/repos/${repoId}/notification-preferences`,
        {
          method: 'PATCH',
          body: JSON.stringify({ mode: notificationMode }),
        },
      );
      setNotificationMode(data.preference.mode);
      notify('Notification preference saved.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to save notification preference.', 'error');
    } finally {
      setIsSavingNotifications(false);
    }
  };

  const switchTab = (tab: RepoSettingsTabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const deleteRepository = async () => {
    if (!workspaceId || !repoId || !repo) {
      return;
    }
    if (deleteConfirmation.trim() !== repo.slug) {
      notify(`Type ${repo.slug} to confirm deletion.`, 'warning');
      return;
    }

    setIsDeletingRepo(true);
    try {
      await apiFetch<{ ok: true }>(`/workspaces/${workspaceId}/repos/${repoId}`, {
        method: 'DELETE',
      });
      notify('Repository deleted.', 'success');
      setIsRepoDeleted(true);
      router.replace(`/workspaces/${workspaceId}/repos`);
      return;
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to delete repository.', 'error');
    } finally {
      setIsDeletingRepo(false);
    }
  };

  const accessSummary = useMemo(
    () => [
      { label: 'Visibility', value: repo ? formatVisibility(repo.visibility) : '-' },
      { label: 'Your role', value: formatRole(repo?.viewerRole) },
      { label: 'Default branch', value: repo?.defaultBranch ?? '-' },
    ],
    [repo],
  );

  return (
    <AppShell>
      {!isRepoDeleted ? (
        <RepoHeader
          workspaceId={workspaceId}
          repoId={repoId}
          repo={repo}
          languages={repo?.languages ?? []}
        />
      ) : null}
      {workspaceId && repoId && !isRepoDeleted ? (
        <RepoNav
          workspaceId={workspaceId}
          repoId={repoId}
          active="settings"
          viewerRole={repo?.viewerRole}
        />
      ) : null}

      {toast ? (
        <PortalToast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}
      {error ? (
        <PortalToast message={error} tone="error" onClose={() => setError(null)} />
      ) : null}

      <PortalPage className="inbox-shell repo-settings-shell">
        <PortalToolbar
          title="Repository settings"
          subtitle="Manage general settings, access, webhooks, and personal access tokens."
          actions={
            <>
              <Link className="inbox-action" href={`/workspaces/${workspaceId}/repos/${repoId}`}>
                Code
              </Link>
              <Link className="inbox-action" href={`/workspaces/${workspaceId}/repos/${repoId}/access`}>
                Access
              </Link>
            </>
          }
        />

        {isLoading ? (
          <PortalCardSkeleton lines={5} />
        ) : repo ? (
          <div className="portal-container portal-stack repo-settings-content stack">
            <RepoSettingsTabs activeTab={activeTab} onChange={switchTab} includeDanger={canAdmin} />

            {activeTab === 'general' ? (
              <Card className="canvas-card repo-settings-section repo-settings-panel">
                <SectionHeader
                  title="General"
                  subtitle="Update repository name, slug, description, and default branch."
                />

                {canAdmin ? (
                  <div className="stack">
                    <label className="field">
                      <span>Repository name</span>
                      <input
                        type="text"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Repository slug</span>
                      <input
                        type="text"
                        value={slug}
                        onChange={(event) => setSlug(event.target.value)}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Description</span>
                      <textarea
                        rows={4}
                        maxLength={280}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Describe what this repository is for"
                      />
                    </label>
                    <label className="field">
                      <span>Default branch</span>
                      <input
                        type="text"
                        value={defaultBranch}
                        onChange={(event) => setDefaultBranch(event.target.value)}
                        required
                      />
                    </label>
                    <InlineFormRow className="repo-settings-form-actions">
                      <Button variant="primary" type="button" onClick={saveGeneral} disabled={isSavingGeneral}>
                        {isSavingGeneral ? 'Saving...' : 'Save changes'}
                      </Button>
                    </InlineFormRow>
                  </div>
                ) : (
                  <p className="muted">You need admin access to edit repository settings.</p>
                )}

                <div className="repo-settings-divider" />

                <h3>Notifications</h3>
                <p className="muted">
                  Control whether this repository follows default notifications, watch mode, or mute mode.
                </p>
                <div className="stack">
                  <label className="field">
                    <span>Repository notification mode</span>
                    <select
                      value={notificationMode}
                      onChange={(event) =>
                        setNotificationMode(event.target.value as RepoNotificationPreference['mode'])
                      }
                    >
                      <option value="DEFAULT">Default (use global settings)</option>
                      <option value="WATCH">Watch (always notify for repo activity)</option>
                      <option value="MUTE">Mute (mentions/review requests only)</option>
                    </select>
                  </label>
                  <InlineFormRow className="repo-settings-form-actions">
                    <Button variant="ghost" type="button" onClick={saveNotificationMode} disabled={isSavingNotifications}>
                      {isSavingNotifications ? 'Saving...' : 'Save notification mode'}
                    </Button>
                    <Button href="/notifications/manage" variant="ghost" size="sm">
                      Open global notification settings
                    </Button>
                  </InlineFormRow>
                </div>
              </Card>
            ) : null}

            {activeTab === 'access' ? (
              <Card className="canvas-card repo-settings-section repo-settings-panel">
                <SectionHeader
                  title="Access and collaborators"
                  subtitle="Manage repository roles, collaborator access, and permission defaults in the access console."
                />

                <div className="repo-settings-summary-grid">
                  {accessSummary.map((item) => (
                    <article key={item.label} className="repo-settings-summary-item">
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </article>
                  ))}
                </div>

                <InlineFormRow className="repo-settings-form-actions">
                  <Button href={`/workspaces/${workspaceId}/repos/${repoId}/access`} variant="primary">
                    Open access controls
                  </Button>
                </InlineFormRow>
              </Card>
            ) : null}

            {activeTab === 'webhooks' ? (
              <Card className="canvas-card repo-settings-section">
                <WebhookList
                  workspaceId={workspaceId}
                  repoId={repoId}
                  canManage={canAdmin}
                  onNotify={notify}
                />
              </Card>
            ) : null}

            {activeTab === 'pats' ? (
              <Card className="canvas-card repo-settings-section">
                <PatManagement onNotify={notify} />
              </Card>
            ) : null}

            {activeTab === 'danger' && canAdmin ? (
              <Card className="canvas-card repo-settings-section repo-danger-section repo-settings-panel">
                <SectionHeader
                  title="Danger zone"
                  subtitle="Destructive actions require explicit confirmation and workspace owner permissions."
                />
                <p className="repo-danger-note">
                  Repository transfer is not available in the API yet. Delete is permanent and removes code,
                  issues, pull requests, comments, and collaborators.
                </p>
                <InlineFormRow className="repo-danger-actions">
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => setIsDeleteConfirmOpen((current) => !current)}
                    disabled={isDeletingRepo}
                  >
                    {isDeleteConfirmOpen ? 'Hide delete confirm' : 'Delete repository'}
                  </Button>
                  <Button type="button" variant="ghost" disabled title="Transfer API endpoint is not implemented yet">
                    Transfer repository
                  </Button>
                </InlineFormRow>
                {isDeleteConfirmOpen ? (
                  <div className="repo-danger-confirm stack">
                    <p className="muted">
                      Type <code>{repo.slug}</code> to confirm permanent deletion.
                    </p>
                    <label className="field">
                      <span>Repository slug confirmation</span>
                      <input
                        type="text"
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                        placeholder={repo.slug}
                        autoComplete="off"
                      />
                    </label>
                    <InlineFormRow className="repo-settings-form-actions">
                      <Button
                        type="button"
                        variant="danger"
                        onClick={deleteRepository}
                        disabled={isDeletingRepo || deleteConfirmation.trim() !== repo.slug}
                      >
                        {isDeletingRepo ? 'Deleting...' : 'Confirm delete'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setIsDeleteConfirmOpen(false);
                          setDeleteConfirmation('');
                        }}
                        disabled={isDeletingRepo}
                      >
                        Cancel
                      </Button>
                    </InlineFormRow>
                  </div>
                ) : null}
              </Card>
            ) : null}
          </div>
        ) : (
          <p className="muted inbox-state">Repository settings could not be loaded.</p>
        )}
      </PortalPage>
    </AppShell>
  );
}

