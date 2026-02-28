'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';
import { PortalToast } from '../../../../components/PortalToast';
import { WorkspaceHeader } from '../../../../components/WorkspaceHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { PortalCardSkeleton, PortalPage } from '../../../../components/portal';
import { apiFetch } from '../../../../lib/api';
import { Button } from '../../../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
  description?: string | null;
  website?: string | null;
  publicProfileEnabled?: boolean;
  publicProfileShowDetails?: boolean;
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

type Member = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
};

type RepoSummary = {
  id: string;
  name: string;
  slug: string;
};

type Tone = 'success' | 'error' | 'warning' | 'info';

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const router = useRouter();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [publicWebsite, setPublicWebsite] = useState('');
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(false);
  const [publicProfileShowDetails, setPublicProfileShowDetails] = useState(true);

  const [memberCount, setMemberCount] = useState(0);
  const [repoCount, setRepoCount] = useState(0);
  const [memberRoleCounts, setMemberRoleCounts] = useState<Record<'OWNER' | 'ADMIN' | 'MEMBER', number>>({
    OWNER: 0,
    ADMIN: 0,
    MEMBER: 0,
  });

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isSavingPublicSettings, setIsSavingPublicSettings] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const workspaceRef = workspace?.slug ?? workspaceId;
  const canManage = workspace?.viewerRole === 'OWNER' || workspace?.viewerRole === 'ADMIN';

  const stats = useMemo(
    () => [
      { label: 'Repositories', value: String(repoCount) },
      { label: 'Members', value: String(memberCount) },
      { label: 'Owners', value: String(memberRoleCounts.OWNER) },
      { label: 'Admins', value: String(memberRoleCounts.ADMIN) },
    ],
    [memberCount, memberRoleCounts.ADMIN, memberRoleCounts.OWNER, repoCount],
  );

  const notify = (message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
  };

  useEffect(() => {
    const load = async () => {
      if (!workspaceId) {
        return;
      }
      setIsLoading(true);
      setError(null);

      try {
        const [workspaceData, memberData, reposData] = await Promise.all([
          apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}`),
          apiFetch<{ members: Member[] }>(`/workspaces/${workspaceId}/members`).catch(() => ({ members: [] })),
          apiFetch<{ repos: RepoSummary[] }>(`/workspaces/${workspaceId}/repos`).catch(() => ({ repos: [] })),
        ]);

        const nextWorkspace = workspaceData.workspace ?? null;
        setWorkspace(nextWorkspace);
        setWorkspaceName(nextWorkspace?.name ?? '');
        setWorkspaceSlug(nextWorkspace?.slug ?? '');
        setPublicDescription(nextWorkspace?.description ?? '');
        setPublicWebsite(nextWorkspace?.website ?? '');
        setPublicProfileEnabled(Boolean(nextWorkspace?.publicProfileEnabled));
        setPublicProfileShowDetails(nextWorkspace?.publicProfileShowDetails ?? true);

        setMemberCount(memberData.members.length);
        setRepoCount(reposData.repos.length);

        const roleCounts: Record<'OWNER' | 'ADMIN' | 'MEMBER', number> = {
          OWNER: 0,
          ADMIN: 0,
          MEMBER: 0,
        };
        memberData.members.forEach((member) => {
          roleCounts[member.role] += 1;
        });
        setMemberRoleCounts(roleCounts);
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'Unable to load settings.';
        setError(message);
        notify(message, 'error');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [workspaceId]);

  const handleRenameWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace || workspace.isPersonal || !canManage) {
      return;
    }

    const nextName = workspaceName.trim();
    const nextSlug = workspaceSlug.trim();

    if (nextName.length < 2) {
      notify('Workspace name must be at least 2 characters.', 'error');
      return;
    }
    if (nextSlug.length < 2) {
      notify('Workspace slug must be at least 2 characters.', 'error');
      return;
    }

    setIsRenaming(true);
    try {
      const data = await apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName, slug: nextSlug }),
      });
      const updatedWorkspace = data.workspace ?? null;
      if (updatedWorkspace) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                name: updatedWorkspace.name,
                slug: updatedWorkspace.slug,
              }
            : prev,
        );
        setWorkspaceName(updatedWorkspace.name);
        setWorkspaceSlug(updatedWorkspace.slug);
      }
      notify('Workspace profile updated.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to update workspace profile.', 'error');
    } finally {
      setIsRenaming(false);
    }
  };

  const handleSavePublicSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace || !canManage) {
      return;
    }

    setIsSavingPublicSettings(true);
    try {
      const data = await apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          description: publicDescription.trim() || null,
          website: publicWebsite.trim() || null,
          publicProfileEnabled,
          publicProfileShowDetails,
        }),
      });
      const updated = data.workspace;
      if (updated) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                description: updated.description ?? null,
                website: updated.website ?? null,
                publicProfileEnabled: updated.publicProfileEnabled,
                publicProfileShowDetails: updated.publicProfileShowDetails,
              }
            : prev,
        );
      }
      notify('Public workspace profile updated.', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to update public profile.', 'error');
    } finally {
      setIsSavingPublicSettings(false);
    }
  };

  const handleDeleteWorkspace = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace || workspace.isPersonal || workspace.viewerRole !== 'OWNER') {
      return;
    }

    if (deleteConfirm.trim() !== workspace.slug) {
      notify('Workspace slug confirmation does not match.', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}`, {
        method: 'DELETE',
      });
      router.push('/workspaces');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : 'Unable to delete workspace.', 'error');
      setIsDeleting(false);
    }
  };

  return (
    <AppShell>
      <WorkspaceHeader workspaceId={workspaceRef} workspace={workspace} />
      {workspace ? (
        <WorkspaceNav
          workspaceId={workspaceRef}
          active="settings"
          viewerRole={workspace.viewerRole}
          isPersonal={workspace.isPersonal}
        />
      ) : null}

      {toast ? (
        <PortalToast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
        />
      ) : null}

      <PortalPage className="inbox-shell repo-settings-shell workspace-settings-shell">
        {isLoading ? (
          <PortalCardSkeleton lines={5} />
        ) : workspace ? (
          <div className="repo-settings-content stack">
            {workspace.isPersonal ? (
              <section className="card canvas-card repo-settings-section workspace-personal-settings-card">
                <div className="workspace-personal-settings-top">
                  <div className="workspace-personal-settings-head">
                    <p className="workspace-personal-settings-eyebrow">Personal workspace</p>
                    <h2>Managed from profile</h2>
                    <p className="muted">
                      Personal workspace name and slug follow your account profile.
                    </p>
                  </div>
                  <Button href="/settings/profile" variant="primary" size="sm">
                    Open profile settings
                  </Button>
                </div>
                <div className="workspace-personal-settings-grid">
                  <article className="workspace-personal-settings-item">
                    <span>Name</span>
                    <strong>{workspace.name}</strong>
                  </article>
                  <article className="workspace-personal-settings-item">
                    <span>Slug</span>
                    <strong>{workspace.slug}</strong>
                  </article>
                  <article className="workspace-personal-settings-item">
                    <span>Access model</span>
                    <strong>Personal only</strong>
                  </article>
                </div>
              </section>
            ) : (
              <>
                <form className="card canvas-card repo-settings-section stack" onSubmit={handleRenameWorkspace}>
                  <h2>Workspace profile</h2>
                  <p className="muted">
                    Update workspace identity for links and sharing. Slug changes are applied immediately.
                  </p>
                  {canManage ? (
                    <>
                      <div className="workspace-settings-inline">
                        <label className="field grow">
                          <span>Workspace name</span>
                          <input
                            type="text"
                            value={workspaceName}
                            onChange={(event) => setWorkspaceName(event.target.value)}
                            placeholder="Workspace name"
                          />
                        </label>
                        <label className="field grow">
                          <span>Workspace slug</span>
                          <input
                            type="text"
                            value={workspaceSlug}
                            onChange={(event) => setWorkspaceSlug(event.target.value)}
                            placeholder="workspace-slug"
                          />
                        </label>
                      </div>
                      <div className="row repo-help-links">
                        <Button variant="primary" type="submit" disabled={isRenaming}>
                          {isRenaming ? 'Saving...' : 'Save profile'}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">Only workspace owners and admins can edit this section.</p>
                  )}
                </form>

                <form className="card canvas-card repo-settings-section stack" onSubmit={handleSavePublicSettings}>
                  <h2>Public workspace page</h2>
                  <p className="muted">Control what non-members see on public workspace URLs.</p>
                  {canManage ? (
                    <>
                      <label className="toggle-row">
                        <span>
                          <strong>Enable public workspace page</strong>
                          <small className="muted">Allow non-members to open workspace public links.</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={publicProfileEnabled}
                          onChange={(event) => setPublicProfileEnabled(event.target.checked)}
                        />
                      </label>
                      <label className="toggle-row">
                        <span>
                          <strong>Show details on public page</strong>
                          <small className="muted">
                            Show description and public repository list when enabled.
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={publicProfileShowDetails}
                          onChange={(event) => setPublicProfileShowDetails(event.target.checked)}
                          disabled={!publicProfileEnabled}
                        />
                      </label>
                      <label className="field">
                        <span>Description</span>
                        <textarea
                          rows={4}
                          maxLength={280}
                          value={publicDescription}
                          onChange={(event) => setPublicDescription(event.target.value)}
                          placeholder="What this workspace is for"
                        />
                      </label>
                      <label className="field">
                        <span>Website</span>
                        <input
                          type="url"
                          value={publicWebsite}
                          onChange={(event) => setPublicWebsite(event.target.value)}
                          placeholder="https://example.com"
                        />
                      </label>
                      <Button variant="primary" type="submit" disabled={isSavingPublicSettings}>
                        {isSavingPublicSettings ? 'Saving...' : 'Save public profile'}
                      </Button>
                    </>
                  ) : (
                    <p className="muted">Only workspace owners and admins can update public profile settings.</p>
                  )}
                </form>

                <form
                  className="card canvas-card repo-settings-section repo-danger-section stack"
                  onSubmit={handleDeleteWorkspace}
                >
                  <h2>Danger zone</h2>
                  <p className="muted">
                    Deleting this workspace removes repositories, teams, members, and related settings.
                  </p>
                  {workspace.viewerRole === 'OWNER' ? (
                    <>
                      <p className="repo-danger-note">
                        Type <strong>{workspace.slug}</strong> to confirm deletion.
                      </p>
                      <label className="field">
                        <span>Workspace slug confirmation</span>
                        <input
                          type="text"
                          value={deleteConfirm}
                          onChange={(event) => setDeleteConfirm(event.target.value)}
                          placeholder={workspace.slug}
                          required
                        />
                      </label>
                      <Button variant="danger" type="submit" disabled={isDeleting}>
                        {isDeleting ? 'Deleting...' : 'Delete workspace'}
                      </Button>
                    </>
                  ) : (
                    <p className="muted">Only the workspace owner can delete this workspace.</p>
                  )}
                </form>
              </>
            )}
          </div>
        ) : (
          <p className="muted inbox-state">Settings could not be loaded.</p>
        )}

        {!isLoading && error && !workspace ? <p className="muted">{error}</p> : null}
      </PortalPage>
    </AppShell>
  );
}

