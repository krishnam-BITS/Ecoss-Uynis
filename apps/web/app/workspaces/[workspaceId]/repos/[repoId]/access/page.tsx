
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../../../components/AppShell';
import { RepoHeader } from '../../../../../../components/RepoHeader';
import { RepoNav } from '../../../../../../components/RepoNav';
import { PortalPage, PortalToolbar } from '../../../../../../components/portal';
import { PortalToast } from '../../../../../../components/PortalToast';
import { DataTable } from '../../../../../../components/repo/DataTable';
import { apiFetch } from '../../../../../../lib/api';

type RepoViewerSource =
  | { type: 'OWNER_OVERRIDE' }
  | { type: 'WORKSPACE_DEFAULT' }
  | { type: 'COLLABORATOR_GRANT' }
  | { type: 'TEAM_GRANT'; teamId: string; teamName: string }
  | { type: 'INTERNAL_VISIBILITY' }
  | { type: 'PUBLIC_VISIBILITY' };

type Repo = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  publicReadRequiresAuth?: boolean;
  defaultBranch: string;
  viewerRole?: 'READ' | 'WRITE' | 'ADMIN' | null;
  viewerRoleSource?: RepoViewerSource | null;
  workspace?: {
    id: string;
    name: string;
    slug?: string;
    isPersonal?: boolean;
  };
  languages?: Array<{
    language: string;
    percent: number;
    color?: string | null;
  }>;
};

type Collaborator = {
  id: string;
  role: 'READ' | 'WRITE' | 'ADMIN';
  createdAt: string;
  user: {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
  };
};

type Team = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
};

type TeamAccess = {
  id: string;
  role: 'READ' | 'WRITE' | 'ADMIN';
  team: Team;
};

type WorkspaceSettings = {
  allowOutsideCollaborators: boolean;
  baseRepoPermission: 'NONE' | 'READ' | 'WRITE';
  publicReadRequiresAuth: boolean;
  adminRepoAccessMode: 'ALL_REPOS_ADMIN' | 'BASE_PERMISSION_ONLY';
};

const accessTabs = ['overview', 'collaborators', 'teams', 'visibility'] as const;
type AccessTab = (typeof accessTabs)[number];

const collaboratorRoleOptions = ['READ', 'WRITE', 'ADMIN'] as const;

const sourceLabel = (source: RepoViewerSource | null | undefined) => {
  if (!source) {
    return 'No effective grant';
  }
  if (source.type === 'OWNER_OVERRIDE') {
    return 'Owner override';
  }
  if (source.type === 'WORKSPACE_DEFAULT') {
    return 'From workspace default';
  }
  if (source.type === 'COLLABORATOR_GRANT') {
    return 'From collaborator grant';
  }
  if (source.type === 'TEAM_GRANT') {
    return `From team: ${source.teamName}`;
  }
  if (source.type === 'INTERNAL_VISIBILITY') {
    return 'From workspace internal visibility';
  }
  return 'From public visibility';
};

export default function RepoAccessPage() {
  const params = useParams<{ workspaceId: string; repoId: string }>();
  const searchParams = useSearchParams();
  const workspaceId = params.workspaceId;
  const repoId = params.repoId;

  const [repo, setRepo] = useState<Repo | null>(null);
  const [visibility, setVisibility] = useState<Repo['visibility']>('PRIVATE');
  const [publicReadRequiresAuth, setPublicReadRequiresAuth] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [teamAccess, setTeamAccess] = useState<TeamAccess[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [workspaceSettings, setWorkspaceSettings] = useState<WorkspaceSettings | null>(null);

  const [collaboratorIdentifier, setCollaboratorIdentifier] = useState('');
  const [role, setRole] = useState<Collaborator['role']>('WRITE');
  const [collaboratorRoleByUserId, setCollaboratorRoleByUserId] = useState<
    Record<string, Collaborator['role']>
  >({});

  const [teamId, setTeamId] = useState('');
  const [teamRole, setTeamRole] = useState<TeamAccess['role']>('READ');
  const [teamRoleByTeamId, setTeamRoleByTeamId] = useState<Record<string, TeamAccess['role']>>({});

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [updatingCollaboratorUserId, setUpdatingCollaboratorUserId] = useState<string | null>(null);
  const [updatingTeamId, setUpdatingTeamId] = useState<string | null>(null);

  const rawTab = (searchParams.get('tab') ?? '').toLowerCase();
  const activeTab: AccessTab = accessTabs.includes(rawTab as AccessTab)
    ? (rawTab as AccessTab)
    : 'overview';

  const canAdmin = repo?.viewerRole === 'ADMIN';
  const isPersonalWorkspace = Boolean(repo?.workspace?.isPersonal);
  const outsideCollaboratorsAllowed = workspaceSettings?.allowOutsideCollaborators ?? true;
  const canAddOutsideCollaborators = isPersonalWorkspace || outsideCollaboratorsAllowed;
  const effectiveReadMode =
    visibility === 'PUBLIC'
      ? publicReadRequiresAuth
        ? 'Public discoverable, read requires sign-in'
        : 'Anonymous public read'
      : visibility === 'INTERNAL'
        ? 'Workspace members can read'
        : 'Read only via explicit grants';
  const viewerAccessLine = `${repo?.viewerRole ?? 'NONE'} (${sourceLabel(repo?.viewerRoleSource ?? null)})`;

  const allowReadCollaboratorRole = visibility !== 'PUBLIC' || publicReadRequiresAuth;

  const addCollaboratorRoleOptions = useMemo(
    () =>
      allowReadCollaboratorRole
        ? [...collaboratorRoleOptions]
        : collaboratorRoleOptions.filter((value) => value !== 'READ'),
    [allowReadCollaboratorRole],
  );

  const tabHref = (tab: AccessTab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    const query = next.toString();
    return query
      ? `/workspaces/${workspaceId}/repos/${repoId}/access?${query}`
      : `/workspaces/${workspaceId}/repos/${repoId}/access`;
  };

  const load = useCallback(async () => {
    if (!workspaceId || !repoId) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus(null);

    try {
      const repoData = await apiFetch<{ repo: Repo }>(
        `/workspaces/${workspaceId}/repos/${repoId}`,
      );
      setRepo(repoData.repo);
      setVisibility(repoData.repo.visibility);
      setPublicReadRequiresAuth(Boolean(repoData.repo.publicReadRequiresAuth));

      if (!repoData.repo.workspace?.isPersonal) {
        try {
          const workspaceSettingsData = await apiFetch<{ workspace?: WorkspaceSettings }>(
            `/workspaces/${workspaceId}/settings`,
          );
          setWorkspaceSettings(workspaceSettingsData.workspace ?? null);
        } catch {
          setWorkspaceSettings(null);
        }
      } else {
        setWorkspaceSettings(null);
      }

      if (repoData.repo.viewerRole === 'ADMIN') {
        const isPersonal = Boolean(repoData.repo.workspace?.isPersonal);
        const [collaboratorData, teamAccessData, teamData] = await Promise.all([
          apiFetch<{ collaborators: Collaborator[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/collaborators`,
          ),
          apiFetch<{ teams: TeamAccess[] }>(
            `/workspaces/${workspaceId}/repos/${repoId}/teams`,
          ),
          isPersonal
            ? Promise.resolve({ teams: [] as Team[] })
            : apiFetch<{ teams: Team[] }>(`/workspaces/${workspaceId}/teams`),
        ]);
        setCollaborators(collaboratorData.collaborators);
        setTeamAccess(teamAccessData.teams);
        setTeams(teamData.teams);
        setTeamId((current) => current || teamData.teams[0]?.id || '');
        setCollaboratorRoleByUserId(
          Object.fromEntries(
            collaboratorData.collaborators.map((collaborator) => [
              collaborator.user.id,
              collaborator.role,
            ]),
          ),
        );
        setTeamRoleByTeamId(
          Object.fromEntries(
            teamAccessData.teams.map((permission) => [permission.team.id, permission.role]),
          ),
        );
      } else {
        setCollaborators([]);
        setTeamAccess([]);
        setTeams([]);
        setCollaboratorRoleByUserId({});
        setTeamRoleByTeamId({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load repository access.');
    } finally {
      setIsLoading(false);
    }
  }, [repoId, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!allowReadCollaboratorRole && role === 'READ') {
      setRole('WRITE');
    }
  }, [allowReadCollaboratorRole, role]);

  useEffect(() => {
    if (repo?.workspace?.isPersonal && visibility === 'INTERNAL') {
      setVisibility('PRIVATE');
    }
  }, [repo?.workspace?.isPersonal, visibility]);

  const handleSaveVisibility = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAdmin) {
      return;
    }

    setIsSavingVisibility(true);
    setError(null);
    setStatus(null);

    try {
      const data = await apiFetch<{ repo: Repo }>(
        `/workspaces/${workspaceId}/repos/${repoId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            visibility,
            publicReadRequiresAuth,
          }),
        },
      );
      setRepo((prev) =>
        prev
          ? {
              ...prev,
              ...data.repo,
              viewerRole: prev.viewerRole ?? data.repo.viewerRole ?? 'ADMIN',
              viewerRoleSource: prev.viewerRoleSource ?? data.repo.viewerRoleSource,
              workspace: prev.workspace ?? data.repo.workspace,
            }
          : data.repo,
      );
      setVisibility(data.repo.visibility);
      setPublicReadRequiresAuth(Boolean(data.repo.publicReadRequiresAuth));
      setStatus('Access policy updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update access policy.');
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const handleAddCollaborator = async (event: FormEvent) => {
    event.preventDefault();
    if (!canAdmin) {
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      const data = await apiFetch<{ collaborator: Collaborator }>(
        `/workspaces/${workspaceId}/repos/${repoId}/collaborators`,
        {
          method: 'POST',
          body: JSON.stringify({ identifier: collaboratorIdentifier, role }),
        },
      );
      setCollaborators((prev) => {
        const existing = prev.find((collab) => collab.user.id === data.collaborator.user.id);
        if (existing) {
          return prev.map((collab) =>
            collab.user.id === data.collaborator.user.id ? data.collaborator : collab,
          );
        }
        return [...prev, data.collaborator];
      });
      setCollaboratorIdentifier('');
      setRole(allowReadCollaboratorRole ? 'READ' : 'WRITE');
      setStatus('Collaborator added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add collaborator.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!canAdmin) {
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      await apiFetch<{ ok: boolean }>(
        `/workspaces/${workspaceId}/repos/${repoId}/collaborators/${userId}`,
        { method: 'DELETE' },
      );
      setCollaborators((prev) => prev.filter((collab) => collab.user.id !== userId));
      setCollaboratorRoleByUserId((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      setStatus('Collaborator removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove collaborator.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateCollaboratorRole = async (collaborator: Collaborator) => {
    if (!canAdmin) {
      return;
    }
    const nextRole = collaboratorRoleByUserId[collaborator.user.id] ?? collaborator.role;
    if (nextRole === collaborator.role) {
      return;
    }
    const identifier = collaborator.user.email || collaborator.user.username || null;
    if (!identifier) {
      setError('Unable to resolve collaborator identifier for role update.');
      return;
    }
    setUpdatingCollaboratorUserId(collaborator.user.id);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ collaborator: Collaborator }>(
        `/workspaces/${workspaceId}/repos/${repoId}/collaborators`,
        {
          method: 'POST',
          body: JSON.stringify({ identifier, role: nextRole }),
        },
      );
      setCollaborators((prev) =>
        prev.map((entry) =>
          entry.user.id === collaborator.user.id ? data.collaborator : entry,
        ),
      );
      setCollaboratorRoleByUserId((prev) => ({
        ...prev,
        [collaborator.user.id]: data.collaborator.role,
      }));
      setStatus('Collaborator role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update collaborator role.');
    } finally {
      setUpdatingCollaboratorUserId(null);
    }
  };

  const handleAddTeamAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!teamId || !canAdmin) {
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      await apiFetch<{ permission: { id: string; role: TeamAccess['role'] } }>(
        `/workspaces/${workspaceId}/teams/${teamId}/repos/${repoId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ role: teamRole }),
        },
      );
      await load();
      setStatus('Team access updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update team access.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveTeamAccess = async (teamIdToRemove: string) => {
    if (!canAdmin) {
      return;
    }
    setIsSaving(true);
    setError(null);

    try {
      await apiFetch<{ ok: boolean }>(
        `/workspaces/${workspaceId}/teams/${teamIdToRemove}/repos/${repoId}`,
        { method: 'DELETE' },
      );
      setTeamAccess((prev) => prev.filter((permission) => permission.team.id !== teamIdToRemove));
      setTeamRoleByTeamId((prev) => {
        const next = { ...prev };
        delete next[teamIdToRemove];
        return next;
      });
      setStatus('Team access removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove team access.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateTeamRole = async (permission: TeamAccess) => {
    if (!canAdmin) {
      return;
    }
    const nextRole = teamRoleByTeamId[permission.team.id] ?? permission.role;
    if (nextRole === permission.role) {
      return;
    }
    setUpdatingTeamId(permission.team.id);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ permission: { id: string; role: TeamAccess['role'] } }>(
        `/workspaces/${workspaceId}/teams/${permission.team.id}/repos/${repoId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ role: nextRole }),
        },
      );
      setTeamAccess((prev) =>
        prev.map((entry) =>
          entry.team.id === permission.team.id ? { ...entry, role: nextRole } : entry,
        ),
      );
      setTeamRoleByTeamId((prev) => ({
        ...prev,
        [permission.team.id]: nextRole,
      }));
      setStatus('Team role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update team role.');
    } finally {
      setUpdatingTeamId(null);
    }
  };

  return (
    <AppShell>
      <RepoHeader
        workspaceId={workspaceId}
        repoId={repoId}
        repo={repo}
        languages={repo?.languages ?? []}
      />
      {workspaceId && repoId ? (
        <RepoNav
          workspaceId={workspaceId}
          repoId={repoId}
          active="access"
          viewerRole={repo?.viewerRole}
        />
      ) : null}
      <PortalPage className="inbox-shell repo-settings-shell repo-access-v3-shell">
        <PortalToolbar
          title="Repository access"
          subtitle="Manage collaborator, team, and visibility controls for this repository."
          actions={(
            <Link className="inbox-action" href={`/workspaces/${workspaceId}/repos/${repoId}/share`}>
              Share
            </Link>
          )}
        />
        {error ? (
          <PortalToast message={error} tone="error" onClose={() => setError(null)} />
        ) : null}
        {status ? (
          <PortalToast message={status} tone="success" onClose={() => setStatus(null)} />
        ) : null}
        {isLoading ? (
          <p className="muted inbox-state">Loading access settings...</p>
        ) : (
          <div className="repo-settings-content stack">
            <div className="workspace-access-tabs settings-nav repo-access-tab-rail">
              {accessTabs.map((tab) => (
                <Link
                  key={tab}
                  className={`workspace-access-tab repo-access-tab ${activeTab === tab ? 'active' : ''}`}
                  href={tabHref(tab)}
                >
                  {tab === 'overview'
                    ? 'Overview'
                    : tab === 'collaborators'
                      ? 'Collaborators'
                      : tab === 'teams'
                        ? 'Teams'
                        : 'Visibility'}
                </Link>
              ))}
            </div>

            {activeTab === 'overview' ? (
              <section className="card canvas-card repo-settings-section stack repo-access-v3-overview">
                <h2>Access overview</h2>
                <div className="repo-access-summary-grid">
                  <div className="repo-access-summary-item">
                    <span>Visibility</span>
                    <strong>{visibility}</strong>
                  </div>
                  <div className="repo-access-summary-item">
                    <span>Effective read mode</span>
                    <strong>{effectiveReadMode}</strong>
                  </div>
                  <div className="repo-access-summary-item">
                    <span>Collaborators</span>
                    <strong>{collaborators.length}</strong>
                  </div>
                  <div className="repo-access-summary-item">
                    <span>Teams</span>
                    <strong>{teamAccess.length}</strong>
                  </div>
                  <div className="repo-access-summary-item">
                    <span>Your role</span>
                    <strong>{repo?.viewerRole ?? 'NONE'}</strong>
                  </div>
                </div>
                <p className="muted">
                  Effective access for you: <strong>{viewerAccessLine}</strong>
                </p>
              </section>
            ) : null}

            {activeTab === 'collaborators' ? (
              <section className="card canvas-card repo-settings-section stack">
                <h2>Collaborators</h2>
                {canAdmin ? (
                  <form className="repo-access-v3-inline" onSubmit={handleAddCollaborator}>
                    <label className="field">
                      <span>Email or username</span>
                      <input
                        type="text"
                        value={collaboratorIdentifier}
                        onChange={(event) => setCollaboratorIdentifier(event.target.value)}
                        placeholder="teammate@company.com or teammate"
                        disabled={!canAddOutsideCollaborators && !isPersonalWorkspace}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Role</span>
                      <select
                        value={role}
                        onChange={(event) => setRole(event.target.value as Collaborator['role'])}
                      >
                        {addCollaboratorRoleOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="primary"
                      type="submit"
                      disabled={isSaving || (!canAddOutsideCollaborators && !isPersonalWorkspace)}
                    >
                      {isSaving ? 'Saving...' : 'Add collaborator'}
                    </button>
                  </form>
                ) : (
                  <p className="muted">You need admin access to manage collaborators.</p>
                )}

                {visibility === 'PUBLIC' && !publicReadRequiresAuth ? (
                  <p className="muted">
                    Public read is controlled by visibility settings. Use collaborator roles for WRITE or ADMIN.
                  </p>
                ) : null}

                <DataTable
                  className="workspace-access-v3-table-wrap"
                  tableClassName="workspace-access-v3-table"
                  rows={collaborators}
                  rowKey={(collaborator) => collaborator.id}
                  emptyMessage="No collaborators yet."
                  columns={[
                    {
                      key: 'user',
                      header: 'User',
                      render: (collaborator) => (
                        <div className="workspace-access-v3-table-user">
                          <strong>
                            {collaborator.user.name ??
                              collaborator.user.username ??
                              collaborator.user.email ??
                              'User'}
                          </strong>
                          <span className="muted">
                            {collaborator.user.email ??
                              (collaborator.user.username
                                ? `@${collaborator.user.username}`
                                : collaborator.user.id)}
                          </span>
                        </div>
                      ),
                    },
                    {
                      key: 'role',
                      header: 'Role',
                      render: (collaborator) => {
                        const roleChoices =
                          collaborator.role === 'READ' || allowReadCollaboratorRole
                            ? [...collaboratorRoleOptions]
                            : collaboratorRoleOptions.filter((value) => value !== 'READ');
                        return canAdmin ? (
                          <select
                            value={collaboratorRoleByUserId[collaborator.user.id] ?? collaborator.role}
                            onChange={(event) =>
                              setCollaboratorRoleByUserId((prev) => ({
                                ...prev,
                                [collaborator.user.id]: event.target.value as Collaborator['role'],
                              }))
                            }
                            disabled={updatingCollaboratorUserId === collaborator.user.id}
                          >
                            {roleChoices.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="chip">{collaborator.role}</span>
                        );
                      },
                    },
                    {
                      key: 'source',
                      header: 'Permission source',
                      render: () => <span className="muted">From collaborator grant</span>,
                    },
                    {
                      key: 'actions',
                      header: 'Actions',
                      align: 'right',
                      cellClassName: 'repo-data-table-actions-cell',
                      render: (collaborator) =>
                        canAdmin ? (
                          <div className="repo-data-table__actions">
                            <button
                              className="ghost small"
                              type="button"
                              disabled={updatingCollaboratorUserId === collaborator.user.id}
                              onClick={() => void handleUpdateCollaboratorRole(collaborator)}
                            >
                              {updatingCollaboratorUserId === collaborator.user.id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="ghost small"
                              type="button"
                              disabled={updatingCollaboratorUserId === collaborator.user.id}
                              onClick={() => handleRemoveCollaborator(collaborator.user.id)}
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <span className="muted">Read-only</span>
                        ),
                    },
                  ]}
                />
              </section>
            ) : null}

            {activeTab === 'teams' ? (
              isPersonalWorkspace ? (
                <section className="card canvas-card repo-settings-section stack">
                  <h2>Teams</h2>
                  <p className="muted">
                    Teams are available only in team workspaces.
                  </p>
                </section>
              ) : (
                <section className="card canvas-card repo-settings-section stack">
                  <h2>Team access</h2>
                  {canAdmin ? (
                    teams.length ? (
                      <form className="repo-access-v3-inline" onSubmit={handleAddTeamAccess}>
                        <label className="field">
                          <span>Team</span>
                          <select
                            value={teamId}
                            onChange={(event) => setTeamId(event.target.value)}
                          >
                            {teams.map((team) => (
                              <option key={team.id} value={team.id}>
                                {team.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field">
                          <span>Role</span>
                          <select
                            value={teamRole}
                            onChange={(event) => setTeamRole(event.target.value as TeamAccess['role'])}
                          >
                            {collaboratorRoleOptions.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="primary" type="submit" disabled={isSaving}>
                          {isSaving ? 'Saving...' : 'Grant access'}
                        </button>
                      </form>
                    ) : (
                      <p className="muted">
                        No teams yet. Create a team in{' '}
                        <Link href={`/workspaces/${workspaceId}/access?tab=teams`}>workspace access</Link>.
                      </p>
                    )
                  ) : (
                    <p className="muted">You need admin access to manage team grants.</p>
                  )}

                  <DataTable
                    className="workspace-access-v3-table-wrap"
                    tableClassName="workspace-access-v3-table"
                    rows={teamAccess}
                    rowKey={(permission) => permission.id}
                    emptyMessage="No team grants yet."
                    columns={[
                      {
                        key: 'team',
                        header: 'Team',
                        render: (permission) => (
                          <div className="workspace-access-v3-table-user">
                            <strong>{permission.team.name}</strong>
                            <span className="muted">@{permission.team.slug}</span>
                          </div>
                        ),
                      },
                      {
                        key: 'role',
                        header: 'Role',
                        render: (permission) =>
                          canAdmin ? (
                            <select
                              value={teamRoleByTeamId[permission.team.id] ?? permission.role}
                              onChange={(event) =>
                                setTeamRoleByTeamId((prev) => ({
                                  ...prev,
                                  [permission.team.id]: event.target.value as TeamAccess['role'],
                                }))
                              }
                              disabled={updatingTeamId === permission.team.id}
                            >
                              {collaboratorRoleOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="chip">{permission.role}</span>
                          ),
                      },
                      {
                        key: 'source',
                        header: 'Permission source',
                        render: (permission) => (
                          <span className="muted">From team: {permission.team.name}</span>
                        ),
                      },
                      {
                        key: 'actions',
                        header: 'Actions',
                        align: 'right',
                        cellClassName: 'repo-data-table-actions-cell',
                        render: (permission) =>
                          canAdmin ? (
                            <div className="repo-data-table__actions">
                              <button
                                className="ghost small"
                                type="button"
                                disabled={updatingTeamId === permission.team.id}
                                onClick={() => void handleUpdateTeamRole(permission)}
                              >
                                {updatingTeamId === permission.team.id ? 'Saving...' : 'Save'}
                              </button>
                              <button
                                className="ghost small"
                                type="button"
                                disabled={updatingTeamId === permission.team.id}
                                onClick={() => handleRemoveTeamAccess(permission.team.id)}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <span className="muted">Read-only</span>
                          ),
                      },
                    ]}
                  />
                </section>
              )
            ) : null}

            {activeTab === 'visibility' ? (
              <section className="card canvas-card repo-settings-section stack">
                <h2>Visibility</h2>
                <p className="muted">Choose who can discover and read this repository.</p>
                {canAdmin ? (
                  <form className="stack" onSubmit={handleSaveVisibility}>
                    <label className="field">
                      <span>Visibility</span>
                      <select
                        value={visibility}
                        onChange={(event) => setVisibility(event.target.value as Repo['visibility'])}
                      >
                        <option value="PRIVATE">Private</option>
                        {!isPersonalWorkspace ? <option value="INTERNAL">Internal</option> : null}
                        <option value="PUBLIC">Public</option>
                      </select>
                    </label>
                    {visibility === 'PUBLIC' ? (
                      <label className="toggle-row">
                        <span>
                          <strong>Public read mode</strong>
                          <small className="muted">
                            {publicReadRequiresAuth
                              ? 'Sign-in required for read access.'
                              : 'Anonymous users can read this repo.'}
                          </small>
                        </span>
                        <input
                          type="checkbox"
                          checked={publicReadRequiresAuth}
                          onChange={(event) => setPublicReadRequiresAuth(event.target.checked)}
                        />
                      </label>
                    ) : (
                      <p className="muted">Effective read mode: {effectiveReadMode}</p>
                    )}
                    <button className="primary" type="submit" disabled={isSavingVisibility}>
                      {isSavingVisibility ? 'Saving...' : 'Save access policy'}
                    </button>
                  </form>
                ) : (
                  <p className="muted">You need admin access to change visibility policy.</p>
                )}
              </section>
            ) : null}
          </div>
        )}
      </PortalPage>
    </AppShell>
  );
}
