
'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../../components/AppShell';
import { WorkspaceHeader } from '../../../../components/WorkspaceHeader';
import { WorkspaceNav } from '../../../../components/WorkspaceNav';
import { PortalModal, PortalPage, PortalToolbar } from '../../../../components/portal';
import { PortalToast } from '../../../../components/PortalToast';
import { apiFetch } from '../../../../lib/api';
import { clearSelectedWorkspaceId } from '../../../../lib/workspace';

const workspaceRoleOptions = ['OWNER', 'ADMIN', 'MEMBER'] as const;
const repoRoleOptions = ['READ', 'WRITE', 'ADMIN'] as const;
const accessTabs = ['policy', 'people', 'teams', 'invites'] as const;
const inviteStatusOptions = ['ALL', 'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const;
const inviteRoleFilterOptions = ['ANY', 'OWNER', 'ADMIN', 'MEMBER'] as const;
const teamDetailTabs = ['members', 'repo-access'] as const;

type AccessTab = (typeof accessTabs)[number];
type TeamDetailTab = (typeof teamDetailTabs)[number];

const workspaceRoleMeta: Record<
  (typeof workspaceRoleOptions)[number],
  { label: string; summary: string }
> = {
  OWNER: {
    label: 'Owner',
    summary: 'Full workspace control, including owner role changes, workspace settings, and lifecycle actions.',
  },
  ADMIN: {
    label: 'Admin',
    summary: 'Manages people, teams, invites, and defaults, but cannot promote or remove owners.',
  },
  MEMBER: {
    label: 'Member',
    summary: 'Standard contributor access. Effective repository permissions come from policy, teams, and direct grants.',
  },
};

const basePermissionLabels: Record<'NONE' | 'READ' | 'WRITE', string> = {
  NONE: 'None',
  READ: 'Read',
  WRITE: 'Write',
};

const adminModeLabels: Record<'ALL_REPOS_ADMIN' | 'BASE_PERMISSION_ONLY', string> = {
  ALL_REPOS_ADMIN: 'Admin on all repos',
  BASE_PERMISSION_ONLY: 'Base permission only',
};

const governanceLabels: Record<'OWNERS_AND_ADMINS' | 'ALL_MEMBERS', string> = {
  OWNERS_AND_ADMINS: 'Owners and admins',
  ALL_MEMBERS: 'All members',
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
  viewerRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null;
};

type WorkspaceSettings = {
  id: string;
  baseRepoPermission: 'NONE' | 'READ' | 'WRITE';
  publicReadRequiresAuth: boolean;
  allowOutsideCollaborators: boolean;
  adminRepoAccessMode: 'ALL_REPOS_ADMIN' | 'BASE_PERMISSION_ONLY';
  repoCreationPolicy: 'OWNERS_AND_ADMINS' | 'ALL_MEMBERS';
  invitePolicy: 'OWNERS_AND_ADMINS' | 'ALL_MEMBERS';
};

type Member = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  createdAt?: string;
  teamCount?: number;
  sourceLabel?: string;
  repoAccessSummary?: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
};

type MemberDetails = {
  member: Member & {
    createdAt: string;
    user: Member['user'] & {
      username?: string | null;
    };
  };
  effectivePermissions: {
    workspaceDefaultRole: 'READ' | 'WRITE' | 'ADMIN' | null;
    workspaceDefaultSource: string | null;
    directGrantSummary: string;
    teamGrantSummary: string;
  };
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    joinedAt: string;
  }>;
  explicitRepoGrants: Array<{
    id: string;
    role: 'READ' | 'WRITE' | 'ADMIN';
    createdAt: string;
    sourceLabel: string;
    repo: {
      id: string;
      name: string;
      slug: string;
      visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
      defaultBranch: string;
    };
  }>;
  teamRepoGrants: Array<{
    id: string;
    role: 'READ' | 'WRITE' | 'ADMIN';
    createdAt: string;
    sourceLabel: string;
    team: {
      id: string;
      name: string;
      slug: string;
    };
    repo: {
      id: string;
      name: string;
      slug: string;
      visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
      defaultBranch: string;
    };
  }>;
  audit: {
    joinedAt: string;
    invitedAt: string | null;
    acceptedAt: string | null;
    invitedBy:
      | {
          id: string;
          name?: string | null;
          username?: string | null;
          email?: string | null;
        }
      | null;
    acceptedBy:
      | {
          id: string;
          name?: string | null;
          username?: string | null;
          email?: string | null;
        }
      | null;
  };
};

type WorkspaceInvite = {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
  invitedEmail?: string | null;
  invitedUsername?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  expiresAt: string;
  message?: string | null;
  invitedBy?: {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
  } | null;
  acceptedBy?: {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
  } | null;
  invitedUser?: {
    id: string;
    email?: string | null;
    username?: string | null;
    name?: string | null;
  } | null;
};

type Team = {
  id: string;
  name: string;
  slug: string;
  memberCount?: number;
  repoGrantCount?: number;
};

type TeamMember = {
  id: string;
  createdAt?: string;
  user: {
    id: string;
    email: string;
    name?: string | null;
  };
};

type RepoSummary = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch: string;
};

type TeamRepoGrant = {
  id: string;
  role: 'READ' | 'WRITE' | 'ADMIN';
  createdAt: string;
  repo: RepoSummary;
};

const includesQuery = (parts: Array<string | null | undefined>, query: string) => {
  if (!query) {
    return true;
  }
  return parts.some((value) => value?.toLowerCase().includes(query));
};

const formatDate = (value?: string | null) => {
  if (!value) {
    return 'Not available';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Not available';
  }
  return parsed.toLocaleString();
};

const getDisplayName = (
  input:
    | {
        name?: string | null;
        username?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
) => {
  if (!input) {
    return 'Unknown';
  }
  return input.name ?? (input.username ? `@${input.username}` : null) ?? input.email ?? 'Unknown';
};

const getInviteTargetIdentifier = (invite: WorkspaceInvite): string | null => {
  if (invite.invitedUsername) {
    return invite.invitedUsername;
  }
  if (invite.invitedUser?.username) {
    return invite.invitedUser.username;
  }
  if (invite.invitedEmail) {
    return invite.invitedEmail;
  }
  if (invite.invitedUser?.email) {
    return invite.invitedUser.email;
  }
  return null;
};

const parseGrantSummary = (summary: string) => {
  const expression = /(\d+)\s+repos?:\s*(READ|WRITE|ADMIN)/gi;
  const matches: RegExpExecArray[] = [];
  let currentMatch = expression.exec(summary);
  while (currentMatch) {
    matches.push(currentMatch);
    currentMatch = expression.exec(summary);
  }

  if (!matches.length) {
    return [] as Array<{ count: number; role: 'READ' | 'WRITE' | 'ADMIN' }>;
  }

  return matches.map((match) => ({
    count: Number(match[1]),
    role: match[2].toUpperCase() as 'READ' | 'WRITE' | 'ADMIN',
  }));
};

const rolePillClassName = (role: string) => {
  const tone = role.toLowerCase();
  return `portal-pill portal-pill--${tone}`;
};

export default function WorkspaceAccessPage() {
  const params = useParams<{ workspaceId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const workspaceId = params.workspaceId;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteLinksById, setInviteLinksById] = useState<Record<string, string>>({});
  const [teams, setTeams] = useState<Team[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);

  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [selectedTeamTab, setSelectedTeamTab] = useState<TeamDetailTab>('members');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamRepoGrants, setTeamRepoGrants] = useState<TeamRepoGrant[]>([]);

  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<Member['role']>('MEMBER');
  const [inviteMessage, setInviteMessage] = useState('');
  const [teamName, setTeamName] = useState('');
  const [selectedPeopleUserId, setSelectedPeopleUserId] = useState('');
  const [teamRepoId, setTeamRepoId] = useState('');
  const [teamRepoRole, setTeamRepoRole] = useState<(typeof repoRoleOptions)[number]>('READ');
  const [inviteStatusFilter, setInviteStatusFilter] =
    useState<(typeof inviteStatusOptions)[number]>('ALL');
  const [inviteRoleFilter, setInviteRoleFilter] =
    useState<(typeof inviteRoleFilterOptions)[number]>('ANY');

  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberDetails, setMemberDetails] = useState<MemberDetails | null>(null);
  const [selectedInviteId, setSelectedInviteId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingTeamMembers, setIsLoadingTeamMembers] = useState(false);
  const [isLoadingTeamRepoGrants, setIsLoadingTeamRepoGrants] = useState(false);
  const [isLoadingMemberDetails, setIsLoadingMemberDetails] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [isCancellingInviteId, setIsCancellingInviteId] = useState<string | null>(null);
  const [isUpdatingMemberId, setIsUpdatingMemberId] = useState<string | null>(null);
  const [isRemovingMemberId, setIsRemovingMemberId] = useState<string | null>(null);
  const [isCreatingTeam, setIsCreatingTeam] = useState(false);
  const [isAddingTeamMember, setIsAddingTeamMember] = useState(false);
  const [isDeletingTeamId, setIsDeletingTeamId] = useState<string | null>(null);
  const [isRemovingTeamMemberId, setIsRemovingTeamMemberId] = useState<string | null>(null);
  const [isSavingTeamGrant, setIsSavingTeamGrant] = useState(false);
  const [isUpdatingTeamGrantRepoId, setIsUpdatingTeamGrantRepoId] = useState<string | null>(null);
  const [isRemovingTeamGrantRepoId, setIsRemovingTeamGrantRepoId] = useState<string | null>(null);
  const [isLeavingWorkspace, setIsLeavingWorkspace] = useState(false);

  const memberDefaultsRef = useRef<HTMLDivElement | null>(null);
  const adminDefaultsRef = useRef<HTMLDivElement | null>(null);
  const publicDefaultsRef = useRef<HTMLDivElement | null>(null);
  const outsideDefaultsRef = useRef<HTMLDivElement | null>(null);
  const governanceDefaultsRef = useRef<HTMLDivElement | null>(null);

  const workspaceRef = workspace?.slug ?? workspaceId;
  const viewerRole = workspace?.viewerRole ?? null;
  const canManage = viewerRole === 'OWNER' || viewerRole === 'ADMIN';
  const canManageMembers = canManage;
  const canManageTeams = canManage;
  const canAssignOwnerRole = viewerRole === 'OWNER';
  const canInvite =
    viewerRole === 'OWNER' ||
    viewerRole === 'ADMIN' ||
    (viewerRole === 'MEMBER' && settings?.invitePolicy === 'ALL_MEMBERS');

  const selectableWorkspaceRoles = useMemo<Array<(typeof workspaceRoleOptions)[number]>>(
    () =>
      canAssignOwnerRole
        ? [...workspaceRoleOptions]
        : workspaceRoleOptions.filter((role) => role !== 'OWNER'),
    [canAssignOwnerRole],
  );

  const selectableInviteRoles = useMemo<Array<(typeof workspaceRoleOptions)[number]>>(() => {
    if (viewerRole === 'OWNER') {
      return [...workspaceRoleOptions];
    }
    if (viewerRole === 'ADMIN') {
      return ['ADMIN', 'MEMBER'];
    }
    return ['MEMBER'];
  }, [viewerRole]);

  const rawTab = (searchParams.get('tab') ?? '').toLowerCase();
  const activeTab: AccessTab = accessTabs.includes(rawTab as AccessTab)
    ? (rawTab as AccessTab)
    : 'policy';
  const globalQuery = (searchParams.get('q') ?? '').trim().toLowerCase();
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const selectedInvite = invites.find((invite) => invite.id === selectedInviteId) ?? null;

  const filteredMembers = useMemo(
    () =>
      members.filter((member) =>
        includesQuery(
          [
            member.user.name,
            member.user.email,
            member.role,
            member.sourceLabel,
            member.repoAccessSummary,
          ],
          globalQuery,
        ),
      ),
    [globalQuery, members],
  );

  const filteredTeams = useMemo(
    () => teams.filter((team) => includesQuery([team.name, team.slug], globalQuery)),
    [globalQuery, teams],
  );

  const filteredTeamMembers = useMemo(
    () =>
      teamMembers.filter((member) =>
        includesQuery([member.user.name, member.user.email], globalQuery),
      ),
    [globalQuery, teamMembers],
  );

  const filteredTeamRepoGrants = useMemo(
    () =>
      teamRepoGrants.filter((grant) =>
        includesQuery(
          [grant.repo.name, grant.repo.slug, grant.repo.visibility, grant.role],
          globalQuery,
        ),
      ),
    [globalQuery, teamRepoGrants],
  );

  const filteredInvites = useMemo(
    () =>
      invites.filter((invite) => {
        if (inviteStatusFilter !== 'ALL' && invite.status !== inviteStatusFilter) {
          return false;
        }
        if (inviteRoleFilter !== 'ANY' && invite.role !== inviteRoleFilter) {
          return false;
        }
        return includesQuery(
          [
            invite.invitedUsername,
            invite.invitedEmail,
            invite.invitedUser?.name,
            invite.invitedUser?.email,
            invite.invitedUser?.username,
            invite.role,
            invite.status,
          ],
          globalQuery,
        );
      }),
    [globalQuery, inviteRoleFilter, inviteStatusFilter, invites],
  );

  const inviteStatusCounts = useMemo(
    () =>
      invites.reduce<Record<(typeof inviteStatusOptions)[number], number>>(
        (acc, invite) => {
          acc.ALL += 1;
          acc[invite.status] += 1;
          return acc;
        },
        {
          ALL: 0,
          PENDING: 0,
          ACCEPTED: 0,
          DECLINED: 0,
          EXPIRED: 0,
          CANCELLED: 0,
        },
      ),
    [invites],
  );

  const pendingInviteCount = inviteStatusCounts.PENDING;

  const availablePeopleForTeam = useMemo(() => {
    if (!selectedTeamId) {
      return [];
    }
    const existingUserIds = new Set(teamMembers.map((member) => member.user.id));
    return members
      .filter((member) => !existingUserIds.has(member.user.id))
      .map((member) => ({
        id: member.user.id,
        label: member.user.name ?? member.user.email,
        email: member.user.email,
      }));
  }, [members, selectedTeamId, teamMembers]);

  const availableReposForTeamGrant = useMemo(() => {
    const grantedRepoIds = new Set(teamRepoGrants.map((grant) => grant.repo.id));
    return repos.filter((repo) => !grantedRepoIds.has(repo.id));
  }, [repos, teamRepoGrants]);

  const focusPolicySection = (
    section: 'member' | 'admin' | 'public' | 'outside' | 'governance',
  ) => {
    const target =
      section === 'member'
        ? memberDefaultsRef.current
        : section === 'admin'
          ? adminDefaultsRef.current
          : section === 'public'
            ? publicDefaultsRef.current
            : section === 'outside'
              ? outsideDefaultsRef.current
              : governanceDefaultsRef.current;
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstFocusable = target.querySelector('select, input, button, textarea');
    if (firstFocusable instanceof HTMLElement) {
      firstFocusable.focus({ preventScroll: true });
    }
  };

  const tabHref = (tab: AccessTab) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    const query = next.toString();
    return query ? `/workspaces/${workspaceRef}/access?${query}` : `/workspaces/${workspaceRef}/access`;
  };

  const loadWorkspaceData = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    setStatus(null);
    try {
      const workspaceData = await apiFetch<{ workspace?: Workspace }>(`/workspaces/${workspaceId}`);
      const nextWorkspace = workspaceData.workspace ?? null;
      setWorkspace(nextWorkspace);

      if (!nextWorkspace || nextWorkspace.isPersonal) {
        setSettings(null);
        setMembers([]);
        setInvites([]);
        setTeams([]);
        setRepos([]);
        setTeamMembers([]);
        setTeamRepoGrants([]);
        return;
      }

      const [membersData, teamsData, settingsData, invitesData, reposData] = await Promise.all([
        apiFetch<{ members: Member[] }>(`/workspaces/${workspaceId}/members`).catch(() => ({
          members: [],
        })),
        apiFetch<{ teams: Team[] }>(`/workspaces/${workspaceId}/teams`).catch(() => ({
          teams: [],
        })),
        apiFetch<{ workspace?: WorkspaceSettings }>(`/workspaces/${workspaceId}/settings`).catch(
          () => ({ workspace: null }),
        ),
        apiFetch<{ invites: WorkspaceInvite[] }>(`/workspaces/${workspaceId}/invites`).catch(() => ({
          invites: [],
        })),
        apiFetch<{ repos: RepoSummary[] }>(`/workspaces/${workspaceId}/repos`).catch(() => ({
          repos: [],
        })),
      ]);

      setMembers(membersData.members);
      setTeams(teamsData.teams);
      setSettings(settingsData.workspace ?? null);
      setInvites(invitesData.invites);
      setRepos(reposData.repos);
      setSelectedTeamId((current) => {
        if (current && teamsData.teams.some((team) => team.id === current)) {
          return current;
        }
        return '';
      });
      setSelectedInviteId((current) => {
        if (current && invitesData.invites.some((invite) => invite.id === current)) {
          return current;
        }
        return null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workspace access.');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  const loadSelectedTeamMembers = useCallback(async () => {
    if (!selectedTeamId) {
      setTeamMembers([]);
      return;
    }
    setIsLoadingTeamMembers(true);
    try {
      const data = await apiFetch<{ members: TeamMember[] }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/members`,
      );
      setTeamMembers(data.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load team members.');
      setTeamMembers([]);
    } finally {
      setIsLoadingTeamMembers(false);
    }
  }, [selectedTeamId, workspaceId]);

  const loadSelectedTeamRepoGrants = useCallback(async () => {
    if (!selectedTeamId) {
      setTeamRepoGrants([]);
      return;
    }
    setIsLoadingTeamRepoGrants(true);
    try {
      const data = await apiFetch<{ team: Team; grants: TeamRepoGrant[] }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/repos`,
      );
      setTeamRepoGrants(data.grants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load team repo access.');
      setTeamRepoGrants([]);
    } finally {
      setIsLoadingTeamRepoGrants(false);
    }
  }, [selectedTeamId, workspaceId]);

  const loadSelectedMemberDetails = useCallback(async () => {
    if (!selectedMemberId) {
      setMemberDetails(null);
      return;
    }
    setIsLoadingMemberDetails(true);
    try {
      const data = await apiFetch<{ details: MemberDetails }>(
        `/workspaces/${workspaceId}/members/${selectedMemberId}/details`,
      );
      setMemberDetails(data.details);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load member details.');
      setMemberDetails(null);
    } finally {
      setIsLoadingMemberDetails(false);
    }
  }, [selectedMemberId, workspaceId]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  useEffect(() => {
    void loadSelectedTeamMembers();
  }, [loadSelectedTeamMembers]);

  useEffect(() => {
    void loadSelectedTeamRepoGrants();
  }, [loadSelectedTeamRepoGrants]);

  useEffect(() => {
    void loadSelectedMemberDetails();
  }, [loadSelectedMemberDetails]);

  useEffect(() => {
    if (!selectableInviteRoles.includes(inviteRole)) {
      setInviteRole('MEMBER');
    }
  }, [inviteRole, selectableInviteRoles]);

  useEffect(() => {
    if (!availablePeopleForTeam.length) {
      setSelectedPeopleUserId('');
      return;
    }
    if (!availablePeopleForTeam.some((person) => person.id === selectedPeopleUserId)) {
      setSelectedPeopleUserId(availablePeopleForTeam[0].id);
    }
  }, [availablePeopleForTeam, selectedPeopleUserId]);

  useEffect(() => {
    if (!availableReposForTeamGrant.length) {
      setTeamRepoId('');
      return;
    }
    if (!availableReposForTeamGrant.some((repo) => repo.id === teamRepoId)) {
      setTeamRepoId(availableReposForTeamGrant[0].id);
    }
  }, [availableReposForTeamGrant, teamRepoId]);

  useEffect(() => {
    if (!selectedMemberId) {
      return;
    }
    if (!members.some((member) => member.id === selectedMemberId)) {
      setSelectedMemberId(null);
      setMemberDetails(null);
    }
  }, [members, selectedMemberId]);

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || !canManage) {
      return;
    }
    setIsSavingSettings(true);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ workspace?: WorkspaceSettings }>(
        `/workspaces/${workspaceId}/settings`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            baseRepoPermission: settings.baseRepoPermission,
            adminRepoAccessMode: settings.adminRepoAccessMode,
            publicReadRequiresAuth: settings.publicReadRequiresAuth,
            allowOutsideCollaborators: settings.allowOutsideCollaborators,
            repoCreationPolicy: settings.repoCreationPolicy,
            invitePolicy: settings.invitePolicy,
          }),
        },
      );
      setSettings(data.workspace ?? null);
      setStatus('Workspace defaults updated.');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to update workspace access settings.',
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleInvite = async (event: FormEvent) => {
    event.preventDefault();
    if (!canInvite) {
      return;
    }
    setIsInviting(true);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ invite: WorkspaceInvite; inviteUrl?: string }>(
        `/workspaces/${workspaceId}/invites`,
        {
          method: 'POST',
          body: JSON.stringify({
            identifier: inviteIdentifier,
            role: inviteRole,
            message: inviteMessage.trim() || undefined,
          }),
        },
      );
      setInvites((prev) => [data.invite, ...prev]);
      const inviteUrl = data.inviteUrl;
      if (typeof inviteUrl === 'string' && inviteUrl.length > 0) {
        setInviteLinksById((prev) => ({ ...prev, [data.invite.id]: inviteUrl }));
      }
      setInviteIdentifier('');
      setInviteRole('MEMBER');
      setInviteMessage('');
      setSelectedInviteId(data.invite.id);
      setStatus('Invite sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create invite.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleResendInvite = async (invite: WorkspaceInvite) => {
    if (!canInvite) {
      return;
    }
    const identifier = getInviteTargetIdentifier(invite);
    if (!identifier) {
      setError('Unable to determine invite target for resend.');
      return;
    }
    setIsInviting(true);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ invite: WorkspaceInvite; inviteUrl?: string }>(
        `/workspaces/${workspaceId}/invites`,
        {
          method: 'POST',
          body: JSON.stringify({
            identifier,
            role: invite.role,
            message: invite.message ?? undefined,
          }),
        },
      );
      setInvites((prev) => [data.invite, ...prev]);
      const inviteUrl = data.inviteUrl;
      if (typeof inviteUrl === 'string' && inviteUrl.length > 0) {
        setInviteLinksById((prev) => ({ ...prev, [data.invite.id]: inviteUrl }));
      }
      setSelectedInviteId(data.invite.id);
      setStatus('Invite resent as a new invite.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend invite.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!canInvite) {
      return;
    }
    setIsCancellingInviteId(inviteId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}/invites/${inviteId}`, {
        method: 'DELETE',
      });
      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
      setInviteLinksById((prev) => {
        const next = { ...prev };
        delete next[inviteId];
        return next;
      });
      if (selectedInviteId === inviteId) {
        setSelectedInviteId(null);
      }
      setStatus('Invite cancelled.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel invite.');
    } finally {
      setIsCancellingInviteId(null);
    }
  };

  const copyInviteLink = async (inviteId: string) => {
    const value = inviteLinksById[inviteId];
    if (!value) {
      setStatus('Invite link is available after creating or resending an invite.');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setStatus('Invite link copied.');
    } catch {
      setError('Unable to copy invite link.');
    }
  };

  const updateMemberRole = async (memberId: string, nextRole: Member['role']) => {
    if (!canManageMembers) {
      return;
    }
    setIsUpdatingMemberId(memberId);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ member: Member }>(
        `/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ role: nextRole }),
        },
      );
      setMembers((prev) =>
        prev.map((member) =>
          member.id === data.member.id
            ? {
                ...member,
                ...data.member,
                teamCount: member.teamCount,
                sourceLabel: member.sourceLabel,
                repoAccessSummary: member.repoAccessSummary,
              }
            : member,
        ),
      );
      setStatus('Member role updated.');
      if (selectedMemberId === memberId) {
        void loadSelectedMemberDetails();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update member role.');
    } finally {
      setIsUpdatingMemberId(null);
    }
  };

  const removeMember = async (memberId: string) => {
    if (!canManageMembers) {
      return;
    }
    setIsRemovingMemberId(memberId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}/members/${memberId}`, {
        method: 'DELETE',
      });
      setMembers((prev) => prev.filter((member) => member.id !== memberId));
      if (selectedMemberId === memberId) {
        setSelectedMemberId(null);
        setMemberDetails(null);
      }
      setStatus('Member removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove member.');
    } finally {
      setIsRemovingMemberId(null);
    }
  };

  const handleCreateTeam = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageTeams) {
      return;
    }
    setIsCreatingTeam(true);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ team: Team }>(`/workspaces/${workspaceId}/teams`, {
        method: 'POST',
        body: JSON.stringify({ name: teamName }),
      });
      const nextTeam: Team = {
        ...data.team,
        memberCount: 0,
        repoGrantCount: 0,
      };
      setTeams((prev) => [...prev, nextTeam]);
      setTeamName('');
      setSelectedTeamId(nextTeam.id);
      setSelectedTeamTab('members');
      setStatus('Team created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create team.');
    } finally {
      setIsCreatingTeam(false);
    }
  };

  const handleAddTeamMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageTeams || !selectedTeamId || !selectedPeopleUserId) {
      return;
    }
    setIsAddingTeamMember(true);
    setError(null);
    setStatus(null);
    try {
      const data = await apiFetch<{ member: TeamMember }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ userId: selectedPeopleUserId }),
        },
      );
      setTeamMembers((prev) => [...prev, data.member]);
      setTeams((prev) =>
        prev.map((team) =>
          team.id === selectedTeamId
            ? { ...team, memberCount: (team.memberCount ?? 0) + 1 }
            : team,
        ),
      );
      setSelectedPeopleUserId('');
      setStatus('Member added to team.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add member to team.');
    } finally {
      setIsAddingTeamMember(false);
    }
  };

  const handleRemoveTeamMember = async (userId: string) => {
    if (!canManageTeams || !selectedTeamId) {
      return;
    }
    setIsRemovingTeamMemberId(userId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/members/${userId}`,
        { method: 'DELETE' },
      );
      setTeamMembers((prev) => prev.filter((member) => member.user.id !== userId));
      setTeams((prev) =>
        prev.map((team) =>
          team.id === selectedTeamId
            ? { ...team, memberCount: Math.max(0, (team.memberCount ?? 0) - 1) }
            : team,
        ),
      );
      setStatus('Member removed from team.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove member from team.');
    } finally {
      setIsRemovingTeamMemberId(null);
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    if (!canManageTeams) {
      return;
    }
    setIsDeletingTeamId(teamId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}/teams/${teamId}`, {
        method: 'DELETE',
      });
      setTeams((prev) => {
        const next = prev.filter((team) => team.id !== teamId);
        setSelectedTeamId((current) => (current === teamId ? (next[0]?.id ?? '') : current));
        return next;
      });
      setTeamMembers([]);
      setTeamRepoGrants([]);
      setStatus('Team deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete team.');
    } finally {
      setIsDeletingTeamId(null);
    }
  };

  const handleAddTeamRepoGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageTeams || !selectedTeamId || !teamRepoId) {
      return;
    }
    setIsSavingTeamGrant(true);
    setError(null);
    setStatus(null);
    const alreadyGranted = teamRepoGrants.some((grant) => grant.repo.id === teamRepoId);
    try {
      await apiFetch<{ permission: { id: string; role: TeamRepoGrant['role'] } }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/repos/${teamRepoId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ role: teamRepoRole }),
        },
      );
      await loadSelectedTeamRepoGrants();
      if (!alreadyGranted) {
        setTeams((prev) =>
          prev.map((team) =>
            team.id === selectedTeamId
              ? { ...team, repoGrantCount: (team.repoGrantCount ?? 0) + 1 }
              : team,
          ),
        );
      }
      setStatus('Team repo access granted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to grant team repo access.');
    } finally {
      setIsSavingTeamGrant(false);
    }
  };

  const handleUpdateTeamRepoGrant = async (repoId: string, role: TeamRepoGrant['role']) => {
    if (!canManageTeams || !selectedTeamId) {
      return;
    }
    setIsUpdatingTeamGrantRepoId(repoId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ permission: { id: string; role: TeamRepoGrant['role'] } }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/repos/${repoId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ role }),
        },
      );
      setTeamRepoGrants((prev) =>
        prev.map((grant) => (grant.repo.id === repoId ? { ...grant, role } : grant)),
      );
      setStatus('Team repo role updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update team repo role.');
    } finally {
      setIsUpdatingTeamGrantRepoId(null);
    }
  };

  const handleRemoveTeamRepoGrant = async (repoId: string) => {
    if (!canManageTeams || !selectedTeamId) {
      return;
    }
    setIsRemovingTeamGrantRepoId(repoId);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(
        `/workspaces/${workspaceId}/teams/${selectedTeamId}/repos/${repoId}`,
        { method: 'DELETE' },
      );
      setTeamRepoGrants((prev) => prev.filter((grant) => grant.repo.id !== repoId));
      setTeams((prev) =>
        prev.map((team) =>
          team.id === selectedTeamId
            ? { ...team, repoGrantCount: Math.max(0, (team.repoGrantCount ?? 0) - 1) }
            : team,
        ),
      );
      setStatus('Team repo access removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove team repo access.');
    } finally {
      setIsRemovingTeamGrantRepoId(null);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!workspace || workspace.isPersonal) {
      return;
    }
    setIsLeavingWorkspace(true);
    setError(null);
    setStatus(null);
    try {
      await apiFetch<{ ok: boolean }>(`/workspaces/${workspaceId}/leave`, {
        method: 'POST',
      });
      clearSelectedWorkspaceId();
      router.replace('/workspaces');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to leave workspace.');
    } finally {
      setIsLeavingWorkspace(false);
    }
  };

  return (
    <AppShell>
      <WorkspaceHeader workspaceId={workspaceRef} workspace={workspace} />
      {workspace ? (
        <WorkspaceNav
          workspaceId={workspaceRef}
          active="access"
          viewerRole={workspace.viewerRole}
          isPersonal={workspace.isPersonal}
        />
      ) : null}

      <PortalPage className="inbox-shell repo-settings-shell workspace-access-shell workspace-access-unified-shell workspace-access-v3">
        <PortalToolbar
          title="Workspace access"
          subtitle="Manage workspace defaults, members, teams, and invites."
        />

        {error ? (
          <PortalToast message={error} tone="error" onClose={() => setError(null)} />
        ) : null}
        {status ? (
          <PortalToast message={status} tone="success" onClose={() => setStatus(null)} />
        ) : null}

        {isLoading ? (
          <p className="muted inbox-state">Loading workspace access...</p>
        ) : workspace?.isPersonal ? (
          <section className="card canvas-card repo-settings-section stack">
            <h2>Personal workspace access</h2>
            <p className="muted">
              Personal workspaces do not support teams or invite-based workspace membership.
            </p>
            <div className="row repo-help-links">
              <Link className="primary" href="/settings/profile">
                Open profile settings
              </Link>
            </div>
          </section>
        ) : (
          <div className="repo-settings-content stack">
            <section className="card canvas-card repo-settings-section repo-access-summary">
              <div className="repo-access-summary-grid">
                <article className="repo-access-summary-item is-info">
                  <span>People</span>
                  <strong>{members.length}</strong>
                </article>
                <article className="repo-access-summary-item is-success">
                  <span>Teams</span>
                  <strong>{teams.length}</strong>
                </article>
                <article className="repo-access-summary-item is-warning">
                  <span>Pending invites</span>
                  <strong>{pendingInviteCount}</strong>
                </article>
                <article className="repo-access-summary-item">
                  <span>Your role</span>
                  <strong>{viewerRole ? workspaceRoleMeta[viewerRole].label : 'Member'}</strong>
                </article>
              </div>
            </section>

            <div className="workspace-access-tab-shell">
              <div className="workspace-access-tabs">
                {accessTabs.map((tab) => (
                  <Link
                    key={tab}
                    className={`workspace-access-tab ${activeTab === tab ? 'active' : ''}`}
                    href={tabHref(tab)}
                  >
                    {tab === 'policy'
                      ? 'Policy'
                      : tab === 'people'
                        ? 'People'
                        : tab === 'teams'
                          ? 'Teams'
                          : 'Invites'}
                  </Link>
                ))}
              </div>
              {globalQuery ? (
                <p className="muted workspace-access-search-note">
                  Filtered by header search: &quot;{searchParams.get('q')}&quot;
                </p>
              ) : null}
            </div>

            {activeTab === 'policy' ? (
              <div className="workspace-access-v3-policy stack">
                <form className="card canvas-card repo-settings-section stack" onSubmit={handleSaveSettings}>
                  <div className="workspace-access-panel-head">
                    <h2>Edit defaults</h2>
                  </div>
                  {canManage ? (
                    <>
                      <div className="workspace-access-v3-form-groups">
                        <div className="workspace-access-v3-form-group" ref={memberDefaultsRef}>
                          <h3>Member defaults</h3>
                          <label className="field">
                            <span>Base permission</span>
                            <select
                              value={settings?.baseRepoPermission ?? 'NONE'}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        baseRepoPermission:
                                          event.target.value as WorkspaceSettings['baseRepoPermission'],
                                      }
                                    : prev,
                                )
                              }
                            >
                              <option value="NONE">None</option>
                              <option value="READ">Read</option>
                              <option value="WRITE">Write</option>
                            </select>
                          </label>
                        </div>

                        <div className="workspace-access-v3-form-group" ref={adminDefaultsRef}>
                          <h3>Admin defaults</h3>
                          <label className="field">
                            <span>Admin repo mode</span>
                            <select
                              value={settings?.adminRepoAccessMode ?? 'BASE_PERMISSION_ONLY'}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        adminRepoAccessMode:
                                          event.target.value as WorkspaceSettings['adminRepoAccessMode'],
                                      }
                                    : prev,
                                )
                              }
                            >
                              <option value="BASE_PERMISSION_ONLY">Base permission only</option>
                              <option value="ALL_REPOS_ADMIN">Admin on all repos</option>
                            </select>
                          </label>
                        </div>

                        <div className="workspace-access-v3-form-group" ref={publicDefaultsRef}>
                          <h3>Public defaults</h3>
                          <label className="field">
                            <span>Public read mode</span>
                            <select
                              value={settings?.publicReadRequiresAuth ? 'require_auth' : 'anon_read'}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        publicReadRequiresAuth: event.target.value === 'require_auth',
                                      }
                                    : prev,
                                )
                              }
                            >
                              <option value="anon_read">Allow anonymous read</option>
                              <option value="require_auth">Require sign-in</option>
                            </select>
                          </label>
                        </div>

                        <div className="workspace-access-v3-form-group" ref={outsideDefaultsRef}>
                          <h3>Outside collaborators</h3>
                          <label className="field">
                            <span>Outside collaborator policy</span>
                            <select
                              value={settings?.allowOutsideCollaborators ? 'allowed' : 'blocked'}
                              onChange={(event) =>
                                setSettings((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        allowOutsideCollaborators: event.target.value === 'allowed',
                                      }
                                    : prev,
                                )
                              }
                            >
                              <option value="allowed">Allowed</option>
                              <option value="blocked">Blocked</option>
                            </select>
                          </label>
                        </div>

                        <div className="workspace-access-v3-form-group" ref={governanceDefaultsRef}>
                          <h3>Governance</h3>
                          <div className="workspace-access-v3-two-col">
                            <label className="field">
                              <span>Who can create repos</span>
                              <select
                                value={settings?.repoCreationPolicy ?? 'ALL_MEMBERS'}
                                onChange={(event) =>
                                  setSettings((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          repoCreationPolicy:
                                            event.target.value as WorkspaceSettings['repoCreationPolicy'],
                                        }
                                      : prev,
                                  )
                                }
                              >
                                <option value="ALL_MEMBERS">All members</option>
                                <option value="OWNERS_AND_ADMINS">Owners and admins</option>
                              </select>
                            </label>
                            <label className="field">
                              <span>Who can invite</span>
                              <select
                                value={settings?.invitePolicy ?? 'OWNERS_AND_ADMINS'}
                                onChange={(event) =>
                                  setSettings((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          invitePolicy:
                                            event.target.value as WorkspaceSettings['invitePolicy'],
                                        }
                                      : prev,
                                  )
                                }
                              >
                                <option value="OWNERS_AND_ADMINS">Owners and admins</option>
                                <option value="ALL_MEMBERS">All members</option>
                              </select>
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="workspace-access-v3-sticky-footer">
                        <button className="primary" type="submit" disabled={isSavingSettings}>
                          {isSavingSettings ? 'Saving...' : 'Save defaults'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      You have read-only access. Ask a workspace owner or admin to edit defaults.
                    </p>
                  )}
                </form>

                <section className="card canvas-card repo-settings-section stack">
                  <details className="workspace-access-guide-dropdown">
                    <summary>How it works</summary>
                    <ul className="workspace-access-role-list">
                      <li>
                        <span className="muted">Workspace defaults set baseline access for members.</span>
                      </li>
                      <li>
                        <span className="muted">Direct collaborator and team grants can elevate repo access.</span>
                      </li>
                      <li>
                        <span className="muted">Ownership always overrides lower grants and defaults.</span>
                      </li>
                    </ul>
                    <p className="muted workspace-access-v3-precedence">
                      Precedence: Owner -&gt; repo collaborator -&gt; team grant -&gt; workspace default -&gt;
                      public read
                    </p>
                  </details>
                </section>

                <section className="card canvas-card repo-settings-section stack repo-danger-section">
                  <h2>Leave workspace</h2>
                  <p className="muted">
                    Leaving removes your workspace membership, team memberships, and direct repository
                    grants in this workspace.
                  </p>
                  <div className="row repo-help-links">
                    <button
                      className="subtle small"
                      type="button"
                      disabled={isLeavingWorkspace}
                      onClick={() => void handleLeaveWorkspace()}
                    >
                      {isLeavingWorkspace ? 'Leaving...' : 'Leave workspace'}
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === 'people' ? (
              <div className="workspace-access-v3-people stack">
                <section className="card canvas-card repo-settings-section stack">
                  <div className="workspace-access-panel-head">
                    <h2>Invite people</h2>
                  </div>
                  {canInvite ? (
                    <form className="workspace-access-v3-form-stack" onSubmit={handleInvite}>
                      <label className="field">
                        <span>Email or username</span>
                        <input
                          type="text"
                          value={inviteIdentifier}
                          onChange={(event) => setInviteIdentifier(event.target.value)}
                          placeholder="teammate@company.com or teammate"
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Role</span>
                        <select
                          value={inviteRole}
                          onChange={(event) => setInviteRole(event.target.value as Member['role'])}
                        >
                          {selectableInviteRoles.map((option) => (
                            <option key={option} value={option}>
                              {workspaceRoleMeta[option].label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Invite note (optional)</span>
                        <input
                          type="text"
                          value={inviteMessage}
                          onChange={(event) => setInviteMessage(event.target.value)}
                          placeholder="Context for this invite"
                          maxLength={180}
                        />
                      </label>
                      <div className="workspace-access-v3-form-footer">
                        <button className="primary" type="submit" disabled={isInviting}>
                          {isInviting ? 'Sending...' : 'Send invite'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="muted">
                      You do not have permission to invite users in this workspace.
                    </p>
                  )}
                </section>

                <section className="card canvas-card repo-settings-section stack">
                  <div className="workspace-access-panel-head">
                    <h2>Members</h2>
                    <span className="chip neutral">{members.length}</span>
                  </div>
                  {filteredMembers.length ? (
                    <div className="workspace-access-v3-table-wrap">
                      <table className="workspace-access-v3-table">
                        <thead>
                          <tr>
                            <th>User</th>
                            <th>Workspace role</th>
                            <th>Source</th>
                            <th>Repo access summary</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMembers.map((member) => (
                            <tr
                              key={member.id}
                              className={selectedMemberId === member.id ? 'is-selected' : ''}
                              onClick={() => setSelectedMemberId(member.id)}
                            >
                              <td>
                                <div className="workspace-access-v3-table-user">
                                  <strong>{member.user.name ?? member.user.email}</strong>
                                  <span className="muted">{member.user.email}</span>
                                </div>
                              </td>
                              <td onClick={(event) => event.stopPropagation()}>
                                {canManageMembers && (canAssignOwnerRole || member.role !== 'OWNER') ? (
                                  <select
                                    className="workspace-access-v3-row-select"
                                    value={member.role}
                                    disabled={isUpdatingMemberId === member.id}
                                    onChange={(event) =>
                                      void updateMemberRole(
                                        member.id,
                                        event.target.value as Member['role'],
                                      )
                                    }
                                  >
                                    {selectableWorkspaceRoles.map((option) => (
                                      <option key={option} value={option}>
                                        {workspaceRoleMeta[option].label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="chip">{workspaceRoleMeta[member.role].label}</span>
                                )}
                              </td>
                              <td>
                                <span className="muted">{member.sourceLabel ?? 'Direct'}</span>
                              </td>
                              <td>
                                <span className="muted">
                                  {member.repoAccessSummary ?? 'No explicit grants'}
                                </span>
                              </td>
                              <td onClick={(event) => event.stopPropagation()}>
                                {canManageMembers ? (
                                  <button
                                    className="ghost small"
                                    type="button"
                                    disabled={
                                      isRemovingMemberId === member.id ||
                                      (!canAssignOwnerRole && member.role === 'OWNER')
                                    }
                                    onClick={() => void removeMember(member.id)}
                                  >
                                    {isRemovingMemberId === member.id ? 'Removing...' : 'Remove'}
                                  </button>
                                ) : (
                                  <span className="muted">Read-only</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">No members match this filter.</p>
                  )}
                </section>

                <PortalModal
                  open={Boolean(selectedMemberId)}
                  onClose={() => {
                    setSelectedMemberId(null);
                    setMemberDetails(null);
                  }}
                  title="Member details"
                  closeLabel="Close member details"
                  panelClassName="workspace-access-v3-details-modal"
                >
                  {isLoadingMemberDetails ? (
                    <p className="muted">Loading member details...</p>
                  ) : memberDetails ? (
                    (() => {
                      const directGrantBreakdown = parseGrantSummary(
                        memberDetails.effectivePermissions.directGrantSummary,
                      );
                      const teamGrantBreakdown = parseGrantSummary(
                        memberDetails.effectivePermissions.teamGrantSummary,
                      );

                      return (
                        <div className="workspace-access-v3-drawer-content">
                          <section className="portal-section">
                            <h3 className="portal-section__title">
                              {memberDetails.member.user.name ?? memberDetails.member.user.email}
                            </h3>
                            <p className="portal-section__hint">{memberDetails.member.user.email}</p>
                            <div className="portal-kv-row">
                              <span className="portal-kv-label">Workspace role</span>
                              <span className={rolePillClassName(memberDetails.member.role)}>
                                {workspaceRoleMeta[memberDetails.member.role].label}
                              </span>
                            </div>
                          </section>

                          <section className="portal-section">
                            <h4 className="portal-section__title">Effective permissions</h4>
                            <div className="portal-kv-list">
                              <div className="portal-kv-row">
                                <span className="portal-kv-label">Workspace default</span>
                                {memberDetails.effectivePermissions.workspaceDefaultRole ? (
                                  <span
                                    className={rolePillClassName(
                                      memberDetails.effectivePermissions.workspaceDefaultRole,
                                    )}
                                  >
                                    {memberDetails.effectivePermissions.workspaceDefaultRole}
                                  </span>
                                ) : (
                                  <strong className="portal-kv-value">None</strong>
                                )}
                              </div>
                              <p className="portal-section__hint">
                                {memberDetails.effectivePermissions.workspaceDefaultSource ??
                                  'Not granted by default'}
                              </p>
                            </div>

                            <div className="portal-summary-block">
                              <p className="portal-kv-label">Direct repo grants</p>
                              {directGrantBreakdown.length ? (
                                <ul className="portal-summary-list">
                                  {directGrantBreakdown.map((entry) => (
                                    <li key={`direct-${entry.role}`}>
                                      <span>{entry.count} repos</span>
                                      <span className={rolePillClassName(entry.role)}>{entry.role}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="portal-section__hint">No direct repo grants.</p>
                              )}
                            </div>

                            <div className="portal-summary-block">
                              <p className="portal-kv-label">Team-based grants</p>
                              {teamGrantBreakdown.length ? (
                                <ul className="portal-summary-list">
                                  {teamGrantBreakdown.map((entry) => (
                                    <li key={`team-${entry.role}`}>
                                      <span>{entry.count} repos</span>
                                      <span className={rolePillClassName(entry.role)}>{entry.role}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="portal-section__hint">No team-based grants.</p>
                              )}
                            </div>
                          </section>

                          <section className="portal-section">
                            <h4 className="portal-section__title">Team memberships</h4>
                            {memberDetails.teams.length ? (
                              <ul className="portal-kv-list">
                                {memberDetails.teams.map((team) => (
                                  <li key={team.id} className="portal-kv-row">
                                    <strong className="portal-kv-value">{team.name}</strong>
                                    <span className="portal-section__hint">Joined {formatDate(team.joinedAt)}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="portal-section__hint">No team memberships.</p>
                            )}
                          </section>

                          <section className="portal-section">
                            <h4 className="portal-section__title">Explicit repo grants</h4>
                            {memberDetails.explicitRepoGrants.length ? (
                              <ul className="portal-kv-list">
                                {memberDetails.explicitRepoGrants.map((grant) => (
                                  <li key={grant.id} className="portal-kv-row portal-kv-row--stacked">
                                    <div>
                                      <strong className="portal-kv-value">{grant.repo.name}</strong>
                                      <p className="portal-section__hint">{grant.sourceLabel}</p>
                                    </div>
                                    <span className={rolePillClassName(grant.role)}>{grant.role}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="portal-section__hint">No direct repo grants.</p>
                            )}
                          </section>

                          <section className="portal-section">
                            <h4 className="portal-section__title">Audit</h4>
                            <ul className="portal-kv-list">
                              <li className="portal-kv-row">
                                <span className="portal-kv-label">Joined</span>
                                <strong className="portal-kv-value">
                                  {formatDate(memberDetails.audit.joinedAt)}
                                </strong>
                              </li>
                              <li className="portal-kv-row">
                                <span className="portal-kv-label">Invited by</span>
                                <strong className="portal-kv-value">
                                  {getDisplayName(memberDetails.audit.invitedBy)}
                                </strong>
                              </li>
                              <li className="portal-kv-row">
                                <span className="portal-kv-label">Accepted by</span>
                                <strong className="portal-kv-value">
                                  {getDisplayName(memberDetails.audit.acceptedBy)}
                                </strong>
                              </li>
                            </ul>
                          </section>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="muted">Unable to load member details.</p>
                  )}
                </PortalModal>
              </div>
            ) : null}

            {activeTab === 'teams' ? (
              <div className="workspace-access-v3-teams stack">
                <section className="card canvas-card repo-settings-section stack">
                  <div className="workspace-access-panel-head">
                    <h2>Create team</h2>
                  </div>
                  {canManageTeams ? (
                    <form className="workspace-access-v3-form-stack" onSubmit={handleCreateTeam}>
                      <label className="field">
                        <span>Team name</span>
                        <input
                          type="text"
                          value={teamName}
                          onChange={(event) => setTeamName(event.target.value)}
                          placeholder="Backend"
                          required
                        />
                      </label>
                      <div className="workspace-access-v3-form-footer workspace-access-v3-form-footer-end">
                        <button className="primary" type="submit" disabled={isCreatingTeam}>
                          {isCreatingTeam ? 'Creating...' : 'Create team'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="muted">You do not have permission to create teams.</p>
                  )}
                </section>

                <section className="card canvas-card repo-settings-section stack">
                  <div className="workspace-access-panel-head">
                    <h2>Teams</h2>
                    <span className="chip neutral">{teams.length}</span>
                  </div>
                  {filteredTeams.length ? (
                    <div className="workspace-access-v3-table-wrap">
                      <table className="workspace-access-v3-table">
                        <thead>
                          <tr>
                            <th>Team</th>
                            <th>Members</th>
                            <th>Repo grants</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTeams.map((team) => (
                            <tr key={team.id}>
                              <td>
                                <div className="workspace-access-v3-table-user">
                                  <strong>{team.name}</strong>
                                  <span className="muted">@{team.slug}</span>
                                </div>
                              </td>
                              <td>
                                <span className="muted">{team.memberCount ?? 0}</span>
                              </td>
                              <td>
                                <span className="muted">{team.repoGrantCount ?? 0}</span>
                              </td>
                              <td>
                                <div className="repo-access-actions">
                                  <button
                                    className="ghost small"
                                    type="button"
                                    onClick={() => {
                                      setSelectedTeamTab('members');
                                      setSelectedTeamId(team.id);
                                    }}
                                  >
                                    Manage
                                  </button>
                                  {canManageTeams ? (
                                    <button
                                      className="ghost small"
                                      type="button"
                                      disabled={isDeletingTeamId === team.id}
                                      onClick={() => void handleDeleteTeam(team.id)}
                                    >
                                      {isDeletingTeamId === team.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">No teams match this filter.</p>
                  )}
                </section>

                <PortalModal
                  open={Boolean(selectedTeam)}
                  onClose={() => setSelectedTeamId('')}
                  title={selectedTeam ? `Team: ${selectedTeam.name}` : 'Team'}
                  closeLabel="Close team management"
                  panelClassName="workspace-access-v3-team-modal"
                  size="wide"
                >
                  {selectedTeam ? (
                    <>
                      <div className="portal-tabs" role="tablist" aria-label="Team management tabs">
                        <button
                          type="button"
                          className={`portal-tab ${selectedTeamTab === 'members' ? 'is-active' : ''}`}
                          role="tab"
                          aria-selected={selectedTeamTab === 'members'}
                          onClick={() => setSelectedTeamTab('members')}
                        >
                          Members
                        </button>
                        <button
                          type="button"
                          className={`portal-tab ${selectedTeamTab === 'repo-access' ? 'is-active' : ''}`}
                          role="tab"
                          aria-selected={selectedTeamTab === 'repo-access'}
                          onClick={() => setSelectedTeamTab('repo-access')}
                        >
                          Repo access
                        </button>
                      </div>

                      {selectedTeamTab === 'members' ? (
                        <div className="stack">
                          {canManageTeams ? (
                            <form className="portal-form-row" onSubmit={handleAddTeamMember}>
                              <label className="portal-field">
                                <span className="portal-label">Add member (workspace members only)</span>
                                <select
                                  className="portal-select"
                                  value={selectedPeopleUserId}
                                  onChange={(event) => setSelectedPeopleUserId(event.target.value)}
                                  disabled={!availablePeopleForTeam.length}
                                  required
                                >
                                  {availablePeopleForTeam.length ? (
                                    availablePeopleForTeam.map((person) => (
                                      <option key={person.id} value={person.id}>
                                        {person.label} ({person.email})
                                      </option>
                                    ))
                                  ) : (
                                    <option value="">No available members</option>
                                  )}
                                </select>
                                <small className="portal-section__hint">
                                  Add existing workspace members to this team.
                                </small>
                              </label>
                              <div className="portal-modal__footer-actions">
                                <button
                                  className="portal-btn portal-btn--primary"
                                  type="submit"
                                  disabled={isAddingTeamMember || !availablePeopleForTeam.length}
                                >
                                  {isAddingTeamMember ? 'Adding...' : 'Add member'}
                                </button>
                              </div>
                            </form>
                          ) : null}
                          {isLoadingTeamMembers ? (
                            <p className="muted">Loading team members...</p>
                          ) : filteredTeamMembers.length ? (
                            <div className="workspace-access-v3-table-wrap portal-table-wrap">
                              <table className="workspace-access-v3-table portal-table portal-table--members">
                                <thead>
                                  <tr className="portal-members-row">
                                    <th>Member</th>
                                    <th>Permission source</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredTeamMembers.map((member) => (
                                    <tr key={member.id} className="portal-members-row">
                                      <td>
                                        <div className="workspace-access-v3-table-user portal-member-cell">
                                          <strong className="portal-member-primary">
                                            {member.user.name ?? member.user.email}
                                          </strong>
                                          <span className="portal-member-secondary">{member.user.email}</span>
                                        </div>
                                      </td>
                                      <td>
                                        <span className="muted">From team: {selectedTeam.name}</span>
                                      </td>
                                      <td className="portal-table-actions">
                                        {canManageTeams ? (
                                          <button
                                            className="portal-btn portal-btn--ghost portal-btn--danger portal-btn--compact portal-btn--action"
                                            type="button"
                                            disabled={isRemovingTeamMemberId === member.user.id}
                                            onClick={() => void handleRemoveTeamMember(member.user.id)}
                                          >
                                            {isRemovingTeamMemberId === member.user.id
                                              ? 'Removing...'
                                              : 'Remove'}
                                          </button>
                                        ) : (
                                          <span className="muted">Read-only</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="stack">
                              <p className="muted">No members in this team yet.</p>
                              <p className="muted">
                                Add workspace members above to start assigning access via this team.
                              </p>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {selectedTeamTab === 'repo-access' ? (
                        <div className="stack">
                          {canManageTeams ? (
                            <form className="portal-form-row" onSubmit={handleAddTeamRepoGrant}>
                              <label className="portal-field">
                                <span className="portal-label">Repository</span>
                                <select
                                  className="portal-select"
                                  value={teamRepoId}
                                  onChange={(event) => setTeamRepoId(event.target.value)}
                                  disabled={!availableReposForTeamGrant.length}
                                  required
                                >
                                  {availableReposForTeamGrant.length ? (
                                    availableReposForTeamGrant.map((repo) => (
                                      <option key={repo.id} value={repo.id}>
                                        {repo.name} ({repo.visibility})
                                      </option>
                                    ))
                                  ) : (
                                    <option value="">All repos already granted</option>
                                  )}
                                </select>
                              </label>
                              <label className="portal-field">
                                <span className="portal-label">Role</span>
                                <select
                                  className="portal-select"
                                  value={teamRepoRole}
                                  onChange={(event) =>
                                    setTeamRepoRole(event.target.value as (typeof repoRoleOptions)[number])
                                  }
                                >
                                  {repoRoleOptions.map((roleOption) => (
                                    <option key={roleOption} value={roleOption}>
                                      {roleOption}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="portal-modal__footer-actions">
                                <button
                                  className="portal-btn portal-btn--primary"
                                  type="submit"
                                  disabled={isSavingTeamGrant || !availableReposForTeamGrant.length}
                                >
                                  {isSavingTeamGrant ? 'Granting...' : 'Grant access'}
                                </button>
                              </div>
                            </form>
                          ) : null}

                          {isLoadingTeamRepoGrants ? (
                            <p className="muted">Loading team repo grants...</p>
                          ) : filteredTeamRepoGrants.length ? (
                            <div className="workspace-access-v3-table-wrap portal-table-wrap">
                              <table className="workspace-access-v3-table portal-table portal-table--repo-access">
                                <thead>
                                  <tr className="portal-repo-access-row">
                                    <th>Repository</th>
                                    <th>Role</th>
                                    <th>Permission source</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredTeamRepoGrants.map((grant) => (
                                    <tr key={grant.id} className="portal-repo-access-row">
                                      <td>
                                        <div className="workspace-access-v3-table-user portal-repo-cell">
                                          <strong>{grant.repo.name}</strong>
                                          <span className="portal-repo-meta">
                                            {grant.repo.visibility} · {grant.repo.defaultBranch}
                                          </span>
                                        </div>
                                      </td>
                                      <td>
                                        {canManageTeams ? (
                                          <select
                                            className="portal-select portal-select--compact workspace-access-v3-row-select portal-role-select"
                                            value={grant.role}
                                            disabled={isUpdatingTeamGrantRepoId === grant.repo.id}
                                            onChange={(event) =>
                                              void handleUpdateTeamRepoGrant(
                                                grant.repo.id,
                                                event.target.value as TeamRepoGrant['role'],
                                              )
                                            }
                                          >
                                            {repoRoleOptions.map((roleOption) => (
                                              <option key={roleOption} value={roleOption}>
                                                {roleOption}
                                              </option>
                                            ))}
                                          </select>
                                        ) : (
                                          <span className="chip">{grant.role}</span>
                                        )}
                                      </td>
                                      <td>
                                        <span className="muted">From team: {selectedTeam.name}</span>
                                      </td>
                                      <td className="portal-table-actions">
                                        {canManageTeams ? (
                                          <button
                                            className="portal-btn portal-btn--ghost portal-btn--danger portal-btn--compact"
                                            type="button"
                                            disabled={isRemovingTeamGrantRepoId === grant.repo.id}
                                            onClick={() => void handleRemoveTeamRepoGrant(grant.repo.id)}
                                          >
                                            {isRemovingTeamGrantRepoId === grant.repo.id
                                              ? 'Removing...'
                                              : 'Remove'}
                                          </button>
                                        ) : (
                                          <span className="muted">Read-only</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="muted">No repository grants for this team.</p>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </PortalModal>
              </div>
            ) : null}

            {activeTab === 'invites' ? (
              <div className="workspace-access-v3-invites stack">
                <section className="card canvas-card repo-settings-section stack workspace-access-v3-invites-card">
                  <div className="workspace-access-panel-head">
                    <h2>Invites</h2>
                    <div className="workspace-access-v3-toolbar-actions">
                      <details className="workspace-access-v3-filter-menu">
                        <summary
                          className="ghost small workspace-access-v3-filter-trigger"
                          aria-label="Filter invites"
                          title="Filter invites"
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                            <path
                              d="M3.75 4.75h12.5L11.5 10.1v4.15l-3 1v-5.15L3.75 4.75Z"
                              fill="currentColor"
                            />
                          </svg>
                        </summary>
                        <div className="workspace-access-v3-filter-menu-content">
                          <label className="field">
                            <span>Status</span>
                            <select
                              value={inviteStatusFilter}
                              onChange={(event) =>
                                setInviteStatusFilter(
                                  event.target.value as (typeof inviteStatusOptions)[number],
                                )
                              }
                            >
                              {inviteStatusOptions.map((statusOption) => (
                                <option key={statusOption} value={statusOption}>
                                  {statusOption === 'ALL' ? 'All' : statusOption}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field">
                            <span>Role</span>
                            <select
                              value={inviteRoleFilter}
                              onChange={(event) =>
                                setInviteRoleFilter(
                                  event.target.value as (typeof inviteRoleFilterOptions)[number],
                                )
                              }
                            >
                              {inviteRoleFilterOptions.map((roleOption) => (
                                <option key={roleOption} value={roleOption}>
                                  {roleOption === 'ANY' ? 'Any' : workspaceRoleMeta[roleOption].label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </details>
                      <span className="chip neutral">{invites.length}</span>
                    </div>
                  </div>
                  {filteredInvites.length ? (
                    <div className="workspace-access-v3-table-wrap">
                      <table className="workspace-access-v3-table">
                        <thead>
                          <tr>
                            <th>Invitee</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Expires</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredInvites.map((invite) => (
                            <tr
                              key={invite.id}
                              className={selectedInviteId === invite.id ? 'is-selected' : ''}
                              onClick={() => setSelectedInviteId(invite.id)}
                            >
                              <td>
                                <div className="workspace-access-v3-table-user">
                                  <strong>
                                    {invite.invitedUsername
                                      ? `@${invite.invitedUsername}`
                                      : invite.invitedEmail ??
                                        invite.invitedUser?.name ??
                                        invite.invitedUser?.email ??
                                        'Invite'}
                                  </strong>
                                  <span className="muted">
                                    {invite.invitedUser?.email ?? invite.invitedEmail ?? 'No email on file'}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <span className="chip">{workspaceRoleMeta[invite.role].label}</span>
                              </td>
                              <td>
                                <span className="muted">{invite.status}</span>
                              </td>
                              <td>
                                <span className="muted">{formatDate(invite.createdAt)}</span>
                              </td>
                              <td>
                                <span className="muted">{formatDate(invite.expiresAt)}</span>
                              </td>
                              <td onClick={(event) => event.stopPropagation()}>
                                <div className="repo-access-actions">
                                  <button
                                    className="ghost small"
                                    type="button"
                                    onClick={() => void copyInviteLink(invite.id)}
                                  >
                                    Copy link
                                  </button>
                                  {canInvite && invite.status === 'PENDING' ? (
                                    <button
                                      className="ghost small"
                                      type="button"
                                      disabled={isCancellingInviteId === invite.id}
                                      onClick={() => void handleCancelInvite(invite.id)}
                                    >
                                      {isCancellingInviteId === invite.id ? 'Cancelling...' : 'Cancel'}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted">No invites match this filter.</p>
                  )}
                </section>

                <PortalModal
                  open={Boolean(selectedInvite)}
                  onClose={() => setSelectedInviteId(null)}
                  title="Invite details"
                  closeLabel="Close invite details"
                  panelClassName="workspace-access-v3-details-modal"
                >
                  {selectedInvite ? (
                    <div className="workspace-access-v3-drawer-content">
                      <section className="portal-section">
                        <h3 className="portal-section__title">
                          {selectedInvite.invitedUsername
                            ? `@${selectedInvite.invitedUsername}`
                            : selectedInvite.invitedEmail ??
                              selectedInvite.invitedUser?.name ??
                              selectedInvite.invitedUser?.email ??
                              'Invite target'}
                        </h3>
                        <div className="portal-kv-list">
                          <div className="portal-kv-row">
                            <span className="portal-kv-label">Role</span>
                            <span className={rolePillClassName(selectedInvite.role)}>
                              {workspaceRoleMeta[selectedInvite.role].label}
                            </span>
                          </div>
                          <div className="portal-kv-row">
                            <span className="portal-kv-label">Status</span>
                            <span className={rolePillClassName(selectedInvite.status)}>
                              {selectedInvite.status}
                            </span>
                          </div>
                        </div>
                      </section>

                      <section className="portal-section">
                        <h4 className="portal-section__title">Invite link</h4>
                        {inviteLinksById[selectedInvite.id] ? (
                          <code className="workspace-access-v3-code portal-code">
                            {inviteLinksById[selectedInvite.id]}
                          </code>
                        ) : (
                          <p className="portal-section__hint">
                            Link is available immediately after creating or resending an invite.
                          </p>
                        )}
                        <div className="portal-modal__footer-actions">
                          <button
                            className="portal-btn portal-btn--secondary"
                            type="button"
                            onClick={() => void copyInviteLink(selectedInvite.id)}
                          >
                            Copy link
                          </button>
                          {canInvite && selectedInvite.status !== 'PENDING' ? (
                            <button
                              className="portal-btn portal-btn--secondary"
                              type="button"
                              disabled={isInviting}
                              onClick={() => void handleResendInvite(selectedInvite)}
                            >
                              {isInviting ? 'Resending...' : 'Resend invite'}
                            </button>
                          ) : null}
                          {canInvite && selectedInvite.status === 'PENDING' ? (
                            <button
                              className="portal-btn portal-btn--ghost portal-btn--danger"
                              type="button"
                              disabled={isCancellingInviteId === selectedInvite.id}
                              onClick={() => void handleCancelInvite(selectedInvite.id)}
                            >
                              {isCancellingInviteId === selectedInvite.id ? 'Cancelling...' : 'Cancel invite'}
                            </button>
                          ) : null}
                        </div>
                      </section>

                      <section className="portal-section">
                        <h4 className="portal-section__title">Status timeline</h4>
                        <ul className="portal-kv-list">
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Created</span>
                            <strong className="portal-kv-value">{formatDate(selectedInvite.createdAt)}</strong>
                          </li>
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Responded</span>
                            <strong className="portal-kv-value">
                              {formatDate(selectedInvite.respondedAt)}
                            </strong>
                          </li>
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Status</span>
                            <span className={rolePillClassName(selectedInvite.status)}>
                              {selectedInvite.status}
                            </span>
                          </li>
                        </ul>
                      </section>

                      <section className="portal-section">
                        <h4 className="portal-section__title">Audit</h4>
                        <ul className="portal-kv-list">
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Invited by</span>
                            <strong className="portal-kv-value">
                              {getDisplayName(selectedInvite.invitedBy)}
                            </strong>
                          </li>
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Accepted by</span>
                            <strong className="portal-kv-value">
                              {getDisplayName(selectedInvite.acceptedBy)}
                            </strong>
                          </li>
                          <li className="portal-kv-row">
                            <span className="portal-kv-label">Expires</span>
                            <strong className="portal-kv-value">{formatDate(selectedInvite.expiresAt)}</strong>
                          </li>
                        </ul>
                      </section>
                    </div>
                  ) : null}
                </PortalModal>
              </div>
            ) : null}
          </div>
        )}
      </PortalPage>
    </AppShell>
  );
}
