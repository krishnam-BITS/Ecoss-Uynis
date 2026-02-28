import { prisma } from './client.js';
import type {
  WorkspaceAdminRepoAccessMode,
  WorkspaceBasePermission,
  RepoRole,
} from '@prisma/client';

const ROLE_RANK: Record<RepoRole, number> = {
  READ: 1,
  WRITE: 2,
  ADMIN: 3,
};

const BASE_PERMISSION_MAP: Record<WorkspaceBasePermission, RepoRole | null> = {
  NONE: null,
  READ: 'READ',
  WRITE: 'WRITE',
};

type RepoAccessWorkspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  baseRepoPermission: WorkspaceBasePermission;
  publicReadRequiresAuth: boolean;
  allowOutsideCollaborators: boolean;
  adminRepoAccessMode: WorkspaceAdminRepoAccessMode;
};

type RepoAccessRepo = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  visibility: string;
  publicReadRequiresAuth: boolean;
  defaultBranch: string;
  workspace: RepoAccessWorkspace;
};

export type RepoAccess = {
  repo: RepoAccessRepo;
  role: RepoRole | null;
  isWorkspaceMember: boolean;
};

export function hasRequiredRole(
  current: RepoRole | null,
  required: RepoRole,
): boolean {
  if (!current) {
    return false;
  }
  return ROLE_RANK[current] >= ROLE_RANK[required];
}

export function isPublicReadable(access: RepoAccess): boolean {
  return (
    access.repo.visibility === 'PUBLIC' &&
    !access.repo.publicReadRequiresAuth
  );
}

function resolveAdminAccessMode(
  mode: WorkspaceAdminRepoAccessMode,
  base: RepoRole | null,
): RepoRole | null {
  if (mode === 'ALL_REPOS_ADMIN') {
    return 'ADMIN';
  }
  return base;
}

const REPO_ACCESS_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  slug: true,
  description: true,
  visibility: true,
  publicReadRequiresAuth: true,
  defaultBranch: true,
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true,
      isPersonal: true,
      ownerUserId: true,
      baseRepoPermission: true,
      publicReadRequiresAuth: true,
      allowOutsideCollaborators: true,
      adminRepoAccessMode: true,
    },
  },
} as const;

function sanitizeBranchRef(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .replace(/^refs\/heads\//, '')
      .replace(/(?:%x1f|\x1f)[0-9a-f]{8,64}/gi, '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim() || 'main'
  );
}

async function buildRepoAccess(
  userId: string | null,
  repo: RepoAccessRepo | null,
): Promise<RepoAccess | null> {

  if (!repo) {
    return null;
  }

  const normalizedRepo: RepoAccessRepo = {
    ...repo,
    defaultBranch: sanitizeBranchRef(repo.defaultBranch),
  };

  if (!userId) {
    return { repo: normalizedRepo, role: null, isWorkspaceMember: false };
  }

  const roles: RepoRole[] = [];
  let isWorkspaceMember = false;

  if (repo.workspace.isPersonal) {
    if (repo.workspace.ownerUserId === userId) {
      roles.push('ADMIN');
    }
  } else {
    const workspaceMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: repo.workspaceId,
          userId,
        },
      },
    });

    if (workspaceMember) {
      isWorkspaceMember = true;
      if (workspaceMember.role === 'OWNER') {
        roles.push('ADMIN');
      } else {
        const baseRole = BASE_PERMISSION_MAP[repo.workspace.baseRepoPermission];
        if (workspaceMember.role === 'ADMIN') {
          const adminRole = resolveAdminAccessMode(
            repo.workspace.adminRepoAccessMode,
            baseRole,
          );
          if (adminRole) {
            roles.push(adminRole);
          }
        } else if (baseRole) {
          roles.push(baseRole);
        }
      }
    }
  }

  const repoMember = await prisma.repoMember.findUnique({
    where: {
      repoId_userId: {
        repoId: repo.id,
        userId,
      },
    },
  });

  if (repoMember) {
    const canUseRepoMemberRole =
      repo.workspace.isPersonal ||
      isWorkspaceMember ||
      (repo.workspace.allowOutsideCollaborators &&
        repo.visibility !== 'INTERNAL');
    if (canUseRepoMemberRole) {
      roles.push(repoMember.role);
    }
  }

  if (!repo.workspace.isPersonal && isWorkspaceMember) {
    if (repo.visibility === 'INTERNAL') {
      roles.push('READ');
    }

    const teamIds = await prisma.teamMember.findMany({
      where: {
        userId,
        team: {
          workspaceId: repo.workspaceId,
        },
      },
      select: {
        teamId: true,
      },
    });

    if (teamIds.length) {
      const permissions = await prisma.teamRepoPermission.findMany({
        where: {
          repoId: repo.id,
          teamId: { in: teamIds.map((team) => team.teamId) },
        },
        select: { role: true },
      });
      roles.push(...permissions.map((permission) => permission.role));
    }
  }

  const role = roles.sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? null;

  return { repo: normalizedRepo, role, isWorkspaceMember };
}

export async function getRepoAccess(
  userId: string | null,
  repoId: string,
): Promise<RepoAccess | null> {
  const repo = await prisma.repo.findUnique({
    where: { id: repoId },
    select: REPO_ACCESS_SELECT,
  });
  return buildRepoAccess(userId, repo);
}

export async function getRepoAccessByRef(
  userId: string | null,
  workspaceRef: string,
  repoRef: string,
): Promise<RepoAccess | null> {
  const workspace = await prisma.workspace.findFirst({
    where: {
      OR: [
        { id: workspaceRef },
        { slug: workspaceRef },
      ],
    },
    select: { id: true },
  });

  if (!workspace) {
    return null;
  }

  let repo = await prisma.repo.findFirst({
    where: {
      id: repoRef,
      workspaceId: workspace.id,
    },
    select: REPO_ACCESS_SELECT,
  });

  if (!repo) {
    repo = await prisma.repo.findFirst({
      where: {
        workspaceId: workspace.id,
        slug: repoRef,
      },
      select: REPO_ACCESS_SELECT,
    });
  }

  return buildRepoAccess(userId, repo);
}

