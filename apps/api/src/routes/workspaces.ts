import type { FastifyInstance } from 'fastify';
import { access, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { prisma, Prisma } from '@uynis/db';
import { z } from 'zod';
import { toSlug, validateRouteSlug } from '../lib/slug.js';
import {
  normalizeDisplayName,
  REPO_NAME_MAX,
  TEAM_NAME_MAX,
  validateRepoName,
  validateTeamName,
  validateWorkspaceName,
  WORKSPACE_NAME_MAX,
} from '../lib/resource-validation.js';
import { cloneBareRepo, importRemoteRepo, initBareRepo, setRepoHead } from '../lib/git.js';
import {
  getRepoDir,
  getRepoLanguageSummary,
  listBranches,
} from '../lib/git-info.js';
import {
  createBranch,
  createCommitWithChanges,
  normalizeRepoPath,
} from '../lib/git-engine.js';
import {
  getRepoBlobRpc,
  getRepoCommitsRpc,
  getRepoTreeRpc,
} from '../lib/git-storage-client.js';
import { selectBranchRule } from '../lib/branch-rules.js';
import { requireRepoAccess } from '../lib/repo-access.js';
import {
  normalizeLabelName,
  pickLabelColor,
  toLabelKey,
} from '../lib/repo-labels.js';
import {
  createRepoAutomationToken,
  normalizeAutomationScopes,
} from '../lib/automation-tokens.js';
import { upsertWebhookSecret } from '../lib/webhook-signature.js';
import { enqueueRepoWebhookEvent, repoWebhookEventTypes } from '../lib/repo-webhooks.js';
import { reindexRepoCodeById } from '../lib/code-search.js';
import { saveImportArchive, scheduleImportJob } from '../lib/import-jobs.js';
import {
  createUploadToken,
  resolveUploadStoragePath,
} from '../lib/upload-tokens.js';
import { getOptionalUserId, requireAuthenticatedUserId } from '../lib/auth.js';
import { sendWorkspaceInviteEmail } from '../lib/email.js';
import {
  generateWorkspaceInviteToken,
  getWorkspaceInviteExpiryDate,
  getWorkspaceInviteTokenPrefix,
  hashWorkspaceInviteToken,
  parseWorkspaceInviteTarget,
} from '../lib/workspace-invites.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(WORKSPACE_NAME_MAX),
  slug: z.string().min(2).max(63).optional(),
});

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

const updateWorkspaceSchema = z
  .object({
    name: z.string().min(2).max(WORKSPACE_NAME_MAX).optional(),
    slug: z.string().min(2).max(63).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.slug !== undefined,
    { message: 'No updates provided.' },
  );

const createTeamSchema = z.object({
  name: z.string().min(2).max(TEAM_NAME_MAX),
  slug: z.string().min(2).max(63).optional(),
});

const createRepoSchema = z.object({
  name: z.string().min(2).max(REPO_NAME_MAX),
  slug: z.string().min(2).max(63).optional(),
  description: z.string().max(280).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'INTERNAL']).optional(),
  initialize: z.boolean().optional(),
});

const forkRepoSchema = z.object({
  targetWorkspaceId: z.string().min(1).optional(),
  name: z.string().min(2).max(REPO_NAME_MAX).optional(),
  slug: z.string().min(2).max(63).optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'INTERNAL']).optional(),
});

const createRepoLabelSchema = z.object({
  name: z.string().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  description: z.string().max(200).optional(),
});

const updateRepoLabelSchema = z
  .object({
    name: z.string().min(1).max(40).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    description: z.string().max(200).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.color !== undefined ||
      value.description !== undefined,
    { message: 'No updates provided.' },
  );

const updateRepoSchema = z.object({
  name: z.string().min(2).max(REPO_NAME_MAX).optional(),
  slug: z.string().min(2).max(63).optional(),
  description: z.string().max(280).nullable().optional(),
  visibility: z.enum(['PUBLIC', 'PRIVATE', 'INTERNAL']).optional(),
  publicReadRequiresAuth: z.boolean().optional(),
  defaultBranch: z.string().min(1).optional(),
});

const updateRepoNotificationPreferenceSchema = z.object({
  mode: z.enum(['DEFAULT', 'WATCH', 'MUTE']),
});

const commitQuerySchema = z.object({
  branch: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

  const importRepoQuerySchema = z.object({
    branch: z.string().min(1).optional(),
    message: z.string().min(3).max(200).optional(),
    maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
  });

const importRemoteSchema = z.object({
  url: z.string().url().max(1000),
  branch: z.string().min(1).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
});

const importUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120).optional(),
  size: z.coerce.number().int().min(1).optional(),
});

const importFromUploadSchema = z.object({
  uploadId: z.string().min(1),
  branch: z.string().min(1).optional(),
  message: z.string().min(3).max(200).optional(),
  maxAttempts: z.coerce.number().int().min(1).max(5).optional(),
});

const repoWebhookEventSchema = z.enum(repoWebhookEventTypes);

const createRepoWebhookSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url().max(2000),
  events: z.array(repoWebhookEventSchema).min(1).max(10),
  active: z.boolean().optional(),
  maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
});

const updateRepoWebhookSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    url: z.string().url().max(2000).optional(),
    events: z.array(repoWebhookEventSchema).min(1).max(10).optional(),
    active: z.boolean().optional(),
    maxAttempts: z.coerce.number().int().min(1).max(10).optional(),
    timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'No updates provided.',
  });

const repoWebhookParamsSchema = z.object({
  workspaceId: z.string().min(1),
  repoId: z.string().min(1),
  webhookId: z.string().min(1),
});

const repoWebhookDeliveriesQuerySchema = z.object({
  webhookId: z.string().min(1).optional(),
  status: z.enum(['QUEUED', 'RUNNING', 'DELIVERED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const treeQuerySchema = z.object({
  branch: z.string().min(1).optional(),
  path: z.string().optional(),
});

const blobQuerySchema = z.object({
  branch: z.string().min(1).optional(),
  path: z.string().min(1),
});

const createBranchSchema = z.object({
  name: z.string().min(1),
  fromBranch: z.string().min(1).optional(),
});

const commitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/i);

const commitCheckSchema = z.object({
  context: z.string().min(1).max(120),
  status: z.enum(['QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE']),
  details: z.string().max(1000).optional(),
});

const commitChangeSchema = z
  .object({
    path: z.string().min(1),
    content: z.string().optional(),
    contentBase64: z.string().optional(),
    delete: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.delete ||
      typeof value.content === 'string' ||
      typeof value.contentBase64 === 'string',
    'Content is required when delete is false.',
  );

const createCommitSchema = z.object({
  branch: z.string().min(1).optional(),
  message: z.string().min(3).max(200),
  changes: z.array(commitChangeSchema).min(1),
  authorName: z.string().min(1).max(120).optional(),
  authorEmail: z.string().email().optional(),
});

const createBranchRuleSchema = z
  .object({
    pattern: z.string().min(1).max(200),
    requirePr: z.boolean().optional(),
    requireCodeOwners: z.boolean().optional(),
    requireApprovals: z.coerce.number().int().min(0).max(10).optional(),
    blockDirectPush: z.boolean().optional(),
    requiredChecks: z.array(z.string().min(1).max(120)).max(20).optional(),
  })
  .refine(
    (value) =>
      value.requirePr !== false ||
      value.requireApprovals === undefined ||
      value.requireApprovals === 0,
    {
      message: 'requireApprovals must be 0 when requirePr is false.',
      path: ['requireApprovals'],
    },
  )
  .refine(
    (value) =>
      value.requireCodeOwners !== true || value.requirePr !== false,
    {
      message: 'requireCodeOwners requires requirePr to be enabled.',
      path: ['requireCodeOwners'],
    },
  );

const updateBranchRuleSchema = z
  .object({
    pattern: z.string().min(1).max(200).optional(),
    requirePr: z.boolean().optional(),
    requireCodeOwners: z.boolean().optional(),
    requireApprovals: z.coerce.number().int().min(0).max(10).optional(),
    blockDirectPush: z.boolean().optional(),
    requiredChecks: z.array(z.string().min(1).max(120)).max(20).optional(),
  })
  .refine(
    (value) =>
      value.requirePr !== false ||
      value.requireApprovals === undefined ||
      value.requireApprovals === 0,
    {
      message: 'requireApprovals must be 0 when requirePr is false.',
      path: ['requireApprovals'],
    },
  )
  .refine(
    (value) =>
      value.requireCodeOwners !== true || value.requirePr !== false,
    {
      message: 'requireCodeOwners requires requirePr to be enabled.',
      path: ['requireCodeOwners'],
    },
  );

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
});

const updateMemberSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

const updateWorkspaceSettingsSchema = z.object({
  baseRepoPermission: z.enum(['NONE', 'READ', 'WRITE']).optional(),
  publicReadRequiresAuth: z.boolean().optional(),
  allowOutsideCollaborators: z.boolean().optional(),
  adminRepoAccessMode: z
    .enum(['ALL_REPOS_ADMIN', 'BASE_PERMISSION_ONLY'])
    .optional(),
  repoCreationPolicy: z.enum(['OWNERS_AND_ADMINS', 'ALL_MEMBERS']).optional(),
  invitePolicy: z.enum(['OWNERS_AND_ADMINS', 'ALL_MEMBERS']).optional(),
  description: z.string().max(280).nullable().optional(),
  website: z.string().max(200).nullable().optional(),
  publicProfileEnabled: z.boolean().optional(),
  publicProfileShowDetails: z.boolean().optional(),
  publicProfileShowDescription: z.boolean().optional(),
  publicProfileShowWebsite: z.boolean().optional(),
  publicProfileShowRepos: z.boolean().optional(),
});

const workspaceInviteSchema = z.object({
  identifier: z.string().min(2).max(200),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).optional(),
  message: z.string().max(280).optional(),
});

const workspaceInviteParamsSchema = z.object({
  workspaceId: z.string().min(1),
  inviteId: z.string().min(1),
});

const workspaceInviteTokenParamsSchema = z.object({
  token: z.string().min(10).max(200),
});

const collaboratorSchema = z.object({
  identifier: z.string().min(2).max(200),
  role: z.enum(['READ', 'WRITE', 'ADMIN']).optional(),
});

const teamMemberSchema = z.object({
  userId: z.string().min(1),
});

const teamRepoPermissionSchema = z.object({
  role: z.enum(['READ', 'WRITE', 'ADMIN']),
});

const removeMemberParamsSchema = z.object({
  workspaceId: z.string().min(1),
  memberId: z.string().min(1),
});

const teamParamsSchema = z.object({
  workspaceId: z.string().min(1),
  teamId: z.string().min(1),
});

const automationTokenSchema = z.object({
  name: z.string().min(3).max(80),
  scopes: z.array(z.string().min(1).max(80)).max(20).optional(),
});

const automationTokenParamsSchema = z.object({
  workspaceId: z.string().min(1),
  repoId: z.string().min(1),
  tokenId: z.string().min(1),
});

function normalizeRequiredChecks(values?: string[]): string[] {
  if (!values?.length) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const dedupeKey = value.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    normalized.push(value);
  }
  return normalized;
}

class PathConflictError extends Error {}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function renamePathIfExists(
  fromPath: string,
  toPath: string,
): Promise<boolean> {
  if (fromPath === toPath) {
    return false;
  }
  const sourceExists = await pathExists(fromPath);
  if (!sourceExists) {
    return false;
  }
  const targetExists = await pathExists(toPath);
  if (targetExists) {
    throw new PathConflictError('Target path already exists.');
  }
  await rename(fromPath, toPath);
  return true;
}

function isAllowedRemoteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) {
      return false;
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function resolveWorkspaceId(workspaceRef: string): Promise<string | null> {
  const byId = await prisma.workspace.findUnique({
    where: { id: workspaceRef },
    select: { id: true },
  });
  if (byId) {
    return byId.id;
  }

  const bySlug = await prisma.workspace.findUnique({
    where: { slug: workspaceRef },
    select: { id: true },
  });

  return bySlug?.id ?? null;
}

async function requireWorkspaceMember(
  workspaceRef: string,
  userId: string,
  allowedRoles?: Array<'OWNER' | 'ADMIN'>,
) {
  const workspaceId = await resolveWorkspaceId(workspaceRef);
  if (!workspaceId) {
    return {
      member: null,
      workspaceId: null,
      error: 'Not a member of this workspace.',
    };
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId,
      },
    },
    select: { workspaceId: true, role: true },
  });

  if (!member) {
    return {
      member: null,
      workspaceId: null,
      error: 'Not a member of this workspace.',
    };
  }

  if (allowedRoles && !allowedRoles.includes(member.role)) {
    return {
      member,
      workspaceId: member.workspaceId,
      error: 'Insufficient permissions.',
    };
  }

  return {
    member,
    workspaceId: member.workspaceId,
    error: null,
  };
}

const workspaceRolePriority: Record<'OWNER' | 'ADMIN' | 'MEMBER', number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
};

type WorkspaceGovernancePolicy = 'OWNERS_AND_ADMINS' | 'ALL_MEMBERS';

function canRoleCreateRepos(
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
  policy: WorkspaceGovernancePolicy,
): boolean {
  return role !== 'MEMBER' || policy === 'ALL_MEMBERS';
}

function canRoleManageInvites(
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
  policy: WorkspaceGovernancePolicy,
): boolean {
  return role !== 'MEMBER' || policy === 'ALL_MEMBERS';
}

function formatRepoGrantSummary(
  counts: Record<'READ' | 'WRITE' | 'ADMIN', number>,
): string {
  const segments = ([
    ['ADMIN', counts.ADMIN],
    ['WRITE', counts.WRITE],
    ['READ', counts.READ],
  ] as const)
    .filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} repos: ${role}`);

  return segments.length ? segments.join(', ') : 'No explicit grants';
}

async function deleteRepoData(
  tx: Prisma.TransactionClient,
  repoId: string,
) {
  const issueIds = await tx.issue.findMany({
    where: { repoId },
    select: { id: true },
  });
  const pullIds = await tx.pullRequest.findMany({
    where: { repoId },
    select: { id: true },
  });

  if (issueIds.length) {
    await tx.issueComment.deleteMany({
      where: { issueId: { in: issueIds.map((issue) => issue.id) } },
    });
  }

  if (pullIds.length) {
    await tx.pullRequestComment.deleteMany({
      where: { pullRequestId: { in: pullIds.map((pull) => pull.id) } },
    });
  }

  await tx.issue.deleteMany({ where: { repoId } });
  await tx.pullRequest.deleteMany({ where: { repoId } });
  await tx.teamRepoPermission.deleteMany({ where: { repoId } });
  await tx.repoMember.deleteMany({ where: { repoId } });
  await tx.branchRule.deleteMany({ where: { repoId } });
  await tx.repo.delete({ where: { id: repoId } });
}

async function ensureRepoStorageDir(
  rootDir: string,
  workspaceSlug: string,
  repoSlug: string,
): Promise<string> {
  try {
    return await getRepoDir(rootDir, workspaceSlug, repoSlug);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === 'ENOENT') {
      return initBareRepo(rootDir, workspaceSlug, repoSlug);
    }
    throw error;
  }
}

function normalizeWorkspaceDescription(
  value: string | null | undefined,
): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeRepoDescription(
  value: string | null | undefined,
): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeWorkspaceWebsite(
  value: string | null | undefined,
): string | null | undefined {
  if (typeof value === 'undefined') {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.length) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function isInviteExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

type InviteViewer = {
  id: string;
  email: string | null;
  username: string | null;
};

async function resolveInviteViewer(userId: string): Promise<InviteViewer | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });
}

function buildInviteRecipientFilters(viewer: InviteViewer): Prisma.WorkspaceInviteWhereInput[] {
  const filters: Prisma.WorkspaceInviteWhereInput[] = [
    { invitedUserId: viewer.id },
  ];

  if (viewer.email) {
    filters.push({
      invitedEmail: {
        equals: viewer.email,
        mode: 'insensitive',
      },
    });
  }

  if (viewer.username) {
    filters.push({
      invitedUsername: {
        equals: viewer.username,
        mode: 'insensitive',
      },
    });
  }

  return filters;
}

function inviteMatchesViewer(
  invite: {
    invitedUserId: string | null;
    invitedEmail: string | null;
    invitedUsername: string | null;
  },
  viewer: InviteViewer,
): boolean {
  if (invite.invitedUserId && invite.invitedUserId === viewer.id) {
    return true;
  }
  if (
    invite.invitedEmail &&
    viewer.email &&
    invite.invitedEmail.toLowerCase() === viewer.email.toLowerCase()
  ) {
    return true;
  }
  if (
    invite.invitedUsername &&
    viewer.username &&
    invite.invitedUsername.toLowerCase() === viewer.username.toLowerCase()
  ) {
    return true;
  }
  return false;
}

function formatInviteViewerLabel(viewer: InviteViewer): string {
  return viewer.username || viewer.email || 'A user';
}

export async function workspaceRoutes(server: FastifyInstance) {
  server.addHook('preHandler', async (request) => {
    const params =
      request.params && typeof request.params === 'object'
        ? (request.params as { workspaceId?: string })
        : null;
    const workspaceRef = params?.workspaceId;
    if (!workspaceRef) {
      return;
    }

    const workspaceId = await resolveWorkspaceId(workspaceRef);
    if (workspaceId) {
      params.workspaceId = workspaceId;
    }
  });

  server.get('/workspaces', async (request) => {
    const userId = await requireAuthenticatedUserId(request);

    const workspaces = await prisma.workspace.findMany({
      where: {
        members: {
          some: {
            userId,
          },
        },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
      },
    });

    return { workspaces };
  });

  server.post('/workspaces', async (request, reply) => {
    const userId = await requireAuthenticatedUserId(request);
    const body = createWorkspaceSchema.parse(request.body);
    const workspaceName = normalizeDisplayName(body.name);
    const workspaceNameError = validateWorkspaceName(workspaceName);
    if (workspaceNameError) {
      return reply.code(400).send({ message: workspaceNameError });
    }
    const slug = toSlug(body.slug?.trim() || workspaceName);
    const slugError = validateRouteSlug(slug);
    if (slugError) {
      return reply.code(400).send({ message: `Invalid workspace slug. ${slugError}` });
    }

    try {
      const workspace = await prisma.workspace.create({
        data: {
          name: workspaceName,
          slug,
          members: {
            create: {
              userId,
              role: 'OWNER',
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          isPersonal: true,
        },
      });

      return reply.code(201).send({ workspace });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ message: 'Workspace slug already exists.' });
        }
      }
      throw error;
    }
  });

  server.get('/workspaces/:workspaceId/public', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const viewerId = await getOptionalUserId(request);

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        description: true,
        website: true,
        publicProfileEnabled: true,
        publicProfileShowDetails: true,
        publicProfileShowDescription: true,
        publicProfileShowWebsite: true,
        publicProfileShowRepos: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    const membership = viewerId
      ? await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: viewerId,
            },
          },
          select: {
            role: true,
          },
        })
      : null;

    const isMember = Boolean(membership);
    const canViewProfile =
      isMember || workspace.isPersonal || workspace.publicProfileEnabled;

    if (!canViewProfile) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    const canViewDetails = isMember || workspace.publicProfileShowDetails;
    const canViewDescription =
      isMember ||
      (workspace.publicProfileShowDetails &&
        workspace.publicProfileShowDescription);
    const canViewWebsite =
      isMember ||
      (workspace.publicProfileShowDetails && workspace.publicProfileShowWebsite);
    const canViewRepos =
      isMember ||
      (workspace.publicProfileShowDetails && workspace.publicProfileShowRepos);

    const repoWhere: Prisma.RepoWhereInput = {
      workspaceId,
      visibility: 'PUBLIC',
    };

    const repos = canViewRepos
      ? await prisma.repo.findMany({
          where: repoWhere,
          orderBy: { updatedAt: 'desc' },
          select: {
            id: true,
            name: true,
            slug: true,
            visibility: true,
            publicReadRequiresAuth: true,
            defaultBranch: true,
            updatedAt: true,
          },
        })
      : [];
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const reposWithLanguages = canViewRepos
      ? await Promise.all(
          repos.map(async (repo) => {
            try {
              const repoDir = await getRepoDir(repoRoot, workspace.slug, repo.slug);
              const summary = await getRepoLanguageSummary(
                repoDir,
                repo.defaultBranch || 'main',
              );
              return {
                ...repo,
                languageBytes: summary.totalBytes,
                languages: summary.languages,
              };
            } catch {
              return {
                ...repo,
                languageBytes: 0,
                languages: [],
              };
            }
          }),
        )
      : [];

    const [openIssues, openPulls] = canViewRepos
      ? await Promise.all([
          prisma.issue.count({
            where: {
              status: 'OPEN',
              repo: repoWhere,
            },
          }),
          prisma.pullRequest.count({
            where: {
              status: 'OPEN',
              repo: repoWhere,
            },
          }),
        ])
      : [0, 0];

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        isPersonal: workspace.isPersonal,
        description: workspace.description,
        website: workspace.website,
        publicProfileEnabled: workspace.publicProfileEnabled,
        publicProfileShowDetails: workspace.publicProfileShowDetails,
        publicProfileShowDescription: workspace.publicProfileShowDescription,
        publicProfileShowWebsite: workspace.publicProfileShowWebsite,
        publicProfileShowRepos: workspace.publicProfileShowRepos,
        viewerRole: membership?.role ?? null,
      },
      visibility: {
        isMember,
        canViewDetails,
        canViewDescription,
        canViewWebsite,
        canViewRepos,
      },
      stats: {
        publicRepoCount: reposWithLanguages.length,
        openIssues,
        openPulls,
      },
      repos: reposWithLanguages.map((repo) => ({
        id: repo.id,
        name: repo.name,
        slug: repo.slug,
        visibility: repo.visibility,
        publicReadRequiresAuth: repo.publicReadRequiresAuth,
        defaultBranch: sanitizeBranchRef(repo.defaultBranch),
        updatedAt: repo.updatedAt,
        languageBytes: repo.languageBytes,
        languages: repo.languages,
      })),
    };
  });

  server.get('/workspaces/:workspaceId', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        description: true,
        website: true,
        publicProfileEnabled: true,
        publicProfileShowDetails: true,
        publicProfileShowDescription: true,
        publicProfileShowWebsite: true,
        publicProfileShowRepos: true,
        baseRepoPermission: true,
        publicReadRequiresAuth: true,
        allowOutsideCollaborators: true,
        adminRepoAccessMode: true,
        repoCreationPolicy: true,
        invitePolicy: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    return {
      workspace: {
        ...workspace,
        viewerRole: membership.member?.role ?? null,
      },
    };
  });

  server.get('/workspaces/:workspaceId/stats', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const [repoCount, openIssues, openPulls] = await Promise.all([
      prisma.repo.count({ where: { workspaceId } }),
      prisma.issue.count({
        where: {
          status: 'OPEN',
          repo: { workspaceId },
        },
      }),
      prisma.pullRequest.count({
        where: {
          status: 'OPEN',
          repo: { workspaceId },
        },
      }),
    ]);

    return {
      stats: {
        repoCount,
        openIssues,
        openPulls,
      },
    };
  });

  server.patch('/workspaces/:workspaceId', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };
    const body = updateWorkspaceSchema.parse(request.body);

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        ownerUserId: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal) {
      return reply.code(400).send({
        message:
          'Personal workspace name follows your username. Change username in profile settings.',
      });
    }

    const nextName = body.name !== undefined ? normalizeDisplayName(body.name) : undefined;
    const hasSlugInput = body.slug !== undefined;
    const nextSlug = hasSlugInput ? toSlug(body.slug.trim()) : undefined;
    const slugChanged = Boolean(hasSlugInput && nextSlug !== workspace.slug);
    const nameChanged = Boolean(
      typeof nextName === 'string' && nextName && nextName !== workspace.name,
    );

    if (!nameChanged && !slugChanged) {
      return reply.code(400).send({ message: 'No updates provided.' });
    }

    if (typeof nextName === 'string') {
      const workspaceNameError = validateWorkspaceName(nextName);
      if (workspaceNameError) {
        return reply.code(400).send({ message: workspaceNameError });
      }
    }

    if (hasSlugInput) {
      const slugError = validateRouteSlug(nextSlug ?? '');
      if (slugError) {
        return reply
          .code(400)
          .send({ message: `Invalid workspace slug. ${slugError}` });
      }
    }

    if (slugChanged && nextSlug) {
      const existingWorkspace = await prisma.workspace.findUnique({
        where: { slug: nextSlug },
        select: { id: true },
      });
      if (existingWorkspace && existingWorkspace.id !== workspace.id) {
        return reply.code(409).send({ message: 'Workspace slug already exists.' });
      }
    }

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const currentWorkspaceDir = path.join(repoRoot, workspace.slug);
    const nextWorkspaceDir = path.join(repoRoot, nextSlug ?? workspace.slug);
    let movedWorkspaceDir = false;

    try {
      if (slugChanged) {
        movedWorkspaceDir = await renamePathIfExists(
          currentWorkspaceDir,
          nextWorkspaceDir,
        );
      }
    } catch (error) {
      if (error instanceof PathConflictError) {
        return reply
          .code(409)
          .send({ message: 'Workspace slug path already exists on disk.' });
      }
      throw error;
    }

    let updated: {
      id: string;
      name: string;
      slug: string;
      isPersonal: boolean;
    };
    try {
      updated = await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          name: nextName ?? undefined,
          slug: nextSlug ?? undefined,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          isPersonal: true,
        },
      });
    } catch (error) {
      if (movedWorkspaceDir) {
        try {
          await renamePathIfExists(nextWorkspaceDir, currentWorkspaceDir);
        } catch {
          // Best effort rollback only.
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ message: 'Workspace slug already exists.' });
      }
      throw error;
    }

    return { workspace: updated };
  });

  server.get('/workspaces/:workspaceId/settings', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        isPersonal: true,
        description: true,
        website: true,
        publicProfileEnabled: true,
        publicProfileShowDetails: true,
        publicProfileShowDescription: true,
        publicProfileShowWebsite: true,
        publicProfileShowRepos: true,
        baseRepoPermission: true,
        publicReadRequiresAuth: true,
        allowOutsideCollaborators: true,
        adminRepoAccessMode: true,
        repoCreationPolicy: true,
        invitePolicy: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    return { workspace };
  });

  server.patch('/workspaces/:workspaceId/settings', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };
    const body = updateWorkspaceSettingsSchema.parse(request.body);

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, isPersonal: true },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (!Object.keys(body).length) {
      return reply.code(400).send({ message: 'No updates provided.' });
    }

    if (body.website !== undefined && body.website !== null) {
      const trimmedWebsite = body.website.trim();
      if (trimmedWebsite.length) {
        try {
          const parsed = new URL(trimmedWebsite);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            return reply.code(400).send({
              message: 'Workspace website must use http(s).',
            });
          }
        } catch {
          return reply.code(400).send({
            message: 'Workspace website must be a valid URL.',
          });
        }
      }
    }

    if (
      workspace.isPersonal &&
      (body.baseRepoPermission !== undefined ||
        body.publicReadRequiresAuth !== undefined ||
        body.allowOutsideCollaborators !== undefined ||
        body.adminRepoAccessMode !== undefined ||
        body.repoCreationPolicy !== undefined ||
        body.invitePolicy !== undefined)
    ) {
      return reply.code(400).send({
        message:
          'Personal workspaces cannot update team access defaults. Update only public profile fields.',
      });
    }

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        description: normalizeWorkspaceDescription(body.description),
        website: normalizeWorkspaceWebsite(body.website),
        publicProfileEnabled: body.publicProfileEnabled,
        publicProfileShowDetails: body.publicProfileShowDetails,
        publicProfileShowDescription: body.publicProfileShowDescription,
        publicProfileShowWebsite: body.publicProfileShowWebsite,
        publicProfileShowRepos: body.publicProfileShowRepos,
        baseRepoPermission: body.baseRepoPermission,
        publicReadRequiresAuth: body.publicReadRequiresAuth,
        allowOutsideCollaborators: body.allowOutsideCollaborators,
        adminRepoAccessMode: body.adminRepoAccessMode,
        repoCreationPolicy: body.repoCreationPolicy,
        invitePolicy: body.invitePolicy,
      },
      select: {
        id: true,
        isPersonal: true,
        description: true,
        website: true,
        publicProfileEnabled: true,
        publicProfileShowDetails: true,
        publicProfileShowDescription: true,
        publicProfileShowWebsite: true,
        publicProfileShowRepos: true,
        baseRepoPermission: true,
        publicReadRequiresAuth: true,
        allowOutsideCollaborators: true,
        adminRepoAccessMode: true,
        repoCreationPolicy: true,
        invitePolicy: true,
      },
    });

    return { workspace: updated };
  });

  server.delete('/workspaces/:workspaceId', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        slug: true,
        isPersonal: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal) {
      return reply.code(400).send({
        message:
          'Personal workspace cannot be deleted. It is tied to your account.',
      });
    }

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const repos = await prisma.repo.findMany({
      where: { workspaceId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      for (const repo of repos) {
        await deleteRepoData(tx, repo.id);
      }

      const teams = await tx.team.findMany({
        where: { workspaceId },
        select: { id: true },
      });
      const teamIds = teams.map((team) => team.id);
      if (teamIds.length) {
        await tx.teamRepoPermission.deleteMany({
          where: { teamId: { in: teamIds } },
        });
        await tx.teamMember.deleteMany({
          where: { teamId: { in: teamIds } },
        });
        await tx.team.deleteMany({
          where: { id: { in: teamIds } },
        });
      }

      await tx.workspaceMember.deleteMany({
        where: { workspaceId },
      });
      await tx.workspace.delete({
        where: { id: workspaceId },
      });
    });

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const workspaceDir = path.join(repoRoot, workspace.slug);
    await rm(workspaceDir, { recursive: true, force: true });

    return { ok: true };
  });

  server.get('/workspaces/:workspaceId/members', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    const userIds = members.map((member) => member.user.id);
    const [teamMemberships, repoGrants] = await Promise.all([
      userIds.length
        ? prisma.teamMember.findMany({
            where: {
              userId: { in: userIds },
              team: { workspaceId },
            },
            select: {
              userId: true,
            },
          })
        : Promise.resolve([]),
      userIds.length
        ? prisma.repoMember.findMany({
            where: {
              userId: { in: userIds },
              repo: { workspaceId },
            },
            select: {
              userId: true,
              role: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const teamCountByUserId = teamMemberships.reduce<Record<string, number>>(
      (acc, membershipRow) => {
        acc[membershipRow.userId] = (acc[membershipRow.userId] ?? 0) + 1;
        return acc;
      },
      {},
    );

    const repoGrantCountsByUserId = repoGrants.reduce<
      Record<string, Record<'READ' | 'WRITE' | 'ADMIN', number>>
    >((acc, grant) => {
      const current = acc[grant.userId] ?? { READ: 0, WRITE: 0, ADMIN: 0 };
      current[grant.role] += 1;
      acc[grant.userId] = current;
      return acc;
    }, {});

    return {
      members: members.map((member) => {
        const teamCount = teamCountByUserId[member.user.id] ?? 0;
        const repoGrantCounts = repoGrantCountsByUserId[member.user.id] ?? {
          READ: 0,
          WRITE: 0,
          ADMIN: 0,
        };
        return {
          ...member,
          teamCount,
          sourceLabel: teamCount ? `Direct + via ${teamCount} teams` : 'Direct',
          repoAccessSummary: formatRepoGrantSummary(repoGrantCounts),
        };
      }),
    };
  });

  server.post('/workspaces/:workspaceId/members', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };
    const body = addMemberSchema.parse(request.body);

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPersonal: true },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal) {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces cannot add members.' });
    }

    if (body.role === 'OWNER' && membership.member?.role !== 'OWNER') {
      return reply
        .code(403)
        .send({ message: 'Only workspace owners can invite another owner.' });
    }

    const user = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    try {
      const member = await prisma.workspaceMember.create({
        data: {
          workspaceId,
          userId: user.id,
          role: body.role ?? 'MEMBER',
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      return reply.code(201).send({ member });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ message: 'User is already a member.' });
        }
      }
      throw error;
    }
  });

  server.patch('/workspaces/:workspaceId/members/:memberId', async (request, reply) => {
    await request.jwtVerify();
    const params = removeMemberParamsSchema.parse(request.params);
    const body = updateMemberSchema.parse(request.body);

    const membership = await requireWorkspaceMember(params.workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const existing = await prisma.workspaceMember.findFirst({
      where: { id: params.memberId, workspaceId: params.workspaceId },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Member not found.' });
    }

    const actorRole = membership.member?.role ?? 'MEMBER';
    if (
      actorRole !== 'OWNER' &&
      (existing.role === 'OWNER' || body.role === 'OWNER')
    ) {
      return reply
        .code(403)
        .send({ message: 'Only workspace owners can manage owner roles.' });
    }

    if (
      existing.role === 'OWNER' &&
      body.role !== 'OWNER'
    ) {
      const ownerCount = await prisma.workspaceMember.count({
        where: {
          workspaceId: params.workspaceId,
          role: 'OWNER',
        },
      });
      if (ownerCount <= 1) {
        return reply
          .code(400)
          .send({ message: 'Workspace must always have at least one owner.' });
      }
    }

    if (
      workspaceRolePriority[actorRole] < workspaceRolePriority[existing.role] &&
      existing.userId !== request.user.sub
    ) {
      return reply
        .code(403)
        .send({ message: 'Insufficient permissions to manage this member.' });
    }

    const updated = await prisma.workspaceMember.update({
      where: { id: params.memberId },
      data: { role: body.role },
      select: {
        id: true,
        role: true,
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return reply.send({ member: updated });
  });

  server.delete('/workspaces/:workspaceId/members/:memberId', async (request, reply) => {
    await request.jwtVerify();
    const params = removeMemberParamsSchema.parse(request.params);

    const membership = await requireWorkspaceMember(params.workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const existing = await prisma.workspaceMember.findFirst({
      where: { id: params.memberId, workspaceId: params.workspaceId },
      select: {
        id: true,
        userId: true,
        role: true,
      },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Member not found.' });
    }

    const actorRole = membership.member?.role ?? 'MEMBER';
    const removingSelf = existing.userId === request.user.sub;
    if (!removingSelf) {
      if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') {
        return reply
          .code(403)
          .send({ message: 'Insufficient permissions to remove this member.' });
      }
      if (existing.role === 'OWNER' && actorRole !== 'OWNER') {
        return reply
          .code(403)
          .send({ message: 'Only workspace owners can remove an owner.' });
      }
      if (workspaceRolePriority[actorRole] < workspaceRolePriority[existing.role]) {
        return reply
          .code(403)
          .send({ message: 'Insufficient permissions to remove this member.' });
      }
    }

    if (existing.role === 'OWNER') {
      const ownerCount = await prisma.workspaceMember.count({
        where: {
          workspaceId: params.workspaceId,
          role: 'OWNER',
        },
      });
      if (ownerCount <= 1) {
        return reply
          .code(400)
          .send({ message: 'Workspace must always have at least one owner.' });
      }
    }

    await prisma.workspaceMember.delete({
      where: { id: params.memberId },
    });

    return reply.send({ ok: true });
  });

  server.get(
    '/workspaces/:workspaceId/members/:memberId/details',
    async (request, reply) => {
      await request.jwtVerify();
      const params = removeMemberParamsSchema.parse(request.params);

      const membership = await requireWorkspaceMember(params.workspaceId, request.user.sub);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }

      const member = await prisma.workspaceMember.findFirst({
        where: {
          id: params.memberId,
          workspaceId: params.workspaceId,
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              username: true,
            },
          },
        },
      });

      if (!member) {
        return reply.code(404).send({ message: 'Member not found.' });
      }

      const [workspaceSettings, teams, explicitRepoGrants, acceptedInvite] = await Promise.all([
        prisma.workspace.findUnique({
          where: { id: params.workspaceId },
          select: {
            baseRepoPermission: true,
            adminRepoAccessMode: true,
          },
        }),
        prisma.teamMember.findMany({
          where: {
            userId: member.user.id,
            team: { workspaceId: params.workspaceId },
          },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            team: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        }),
        prisma.repoMember.findMany({
          where: {
            userId: member.user.id,
            repo: { workspaceId: params.workspaceId },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            role: true,
            createdAt: true,
            repo: {
              select: {
                id: true,
                name: true,
                slug: true,
                visibility: true,
                defaultBranch: true,
              },
            },
          },
        }),
        prisma.workspaceInvite.findFirst({
          where: {
            workspaceId: params.workspaceId,
            invitedUserId: member.user.id,
            status: 'ACCEPTED',
          },
          orderBy: { respondedAt: 'desc' },
          select: {
            id: true,
            createdAt: true,
            respondedAt: true,
            invitedBy: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              },
            },
            acceptedBy: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
              },
            },
          },
        }),
      ]);

      const teamRepoGrants = teams.length
        ? await prisma.teamRepoPermission.findMany({
            where: {
              teamId: { in: teams.map((entry) => entry.team.id) },
              repo: { workspaceId: params.workspaceId },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              role: true,
              createdAt: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                },
              },
              repo: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  visibility: true,
                  defaultBranch: true,
                },
              },
            },
          })
        : [];

      const directGrantCounts = explicitRepoGrants.reduce<Record<'READ' | 'WRITE' | 'ADMIN', number>>(
        (acc, grant) => {
          acc[grant.role] += 1;
          return acc;
        },
        { READ: 0, WRITE: 0, ADMIN: 0 },
      );

      const teamGrantCounts = teamRepoGrants.reduce<Record<'READ' | 'WRITE' | 'ADMIN', number>>(
        (acc, grant) => {
          acc[grant.role] += 1;
          return acc;
        },
        { READ: 0, WRITE: 0, ADMIN: 0 },
      );

      let workspaceDefaultRole: 'READ' | 'WRITE' | 'ADMIN' | null = null;
      let workspaceDefaultSource: string | null = null;

      if (member.role === 'OWNER') {
        workspaceDefaultRole = 'ADMIN';
        workspaceDefaultSource = 'Owner override';
      } else if (member.role === 'ADMIN') {
        if (workspaceSettings?.adminRepoAccessMode === 'ALL_REPOS_ADMIN') {
          workspaceDefaultRole = 'ADMIN';
          workspaceDefaultSource = 'From workspace default';
        } else if (workspaceSettings?.baseRepoPermission === 'WRITE') {
          workspaceDefaultRole = 'WRITE';
          workspaceDefaultSource = 'From workspace default';
        } else if (workspaceSettings?.baseRepoPermission === 'READ') {
          workspaceDefaultRole = 'READ';
          workspaceDefaultSource = 'From workspace default';
        }
      } else if (workspaceSettings?.baseRepoPermission === 'WRITE') {
        workspaceDefaultRole = 'WRITE';
        workspaceDefaultSource = 'From workspace default';
      } else if (workspaceSettings?.baseRepoPermission === 'READ') {
        workspaceDefaultRole = 'READ';
        workspaceDefaultSource = 'From workspace default';
      }

      return reply.send({
        details: {
          member,
          effectivePermissions: {
            workspaceDefaultRole,
            workspaceDefaultSource,
            directGrantSummary: formatRepoGrantSummary(directGrantCounts),
            teamGrantSummary: formatRepoGrantSummary(teamGrantCounts),
          },
          teams: teams.map((entry) => ({
            id: entry.team.id,
            name: entry.team.name,
            slug: entry.team.slug,
            joinedAt: entry.createdAt,
          })),
          explicitRepoGrants: explicitRepoGrants.map((grant) => ({
            ...grant,
            sourceLabel: 'From collaborator grant',
          })),
          teamRepoGrants: teamRepoGrants.map((grant) => ({
            ...grant,
            sourceLabel: `From team: ${grant.team.name}`,
          })),
          audit: {
            joinedAt: member.createdAt,
            invitedAt: acceptedInvite?.createdAt ?? null,
            acceptedAt: acceptedInvite?.respondedAt ?? null,
            invitedBy: acceptedInvite?.invitedBy ?? null,
            acceptedBy: acceptedInvite?.acceptedBy ?? null,
          },
        },
      });
    },
  );

  server.post('/workspaces/:workspaceId/leave', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error || !membership.member) {
      return reply.code(403).send({ message: membership.error ?? 'Not a member of this workspace.' });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, isPersonal: true },
    });
    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }
    if (workspace.isPersonal) {
      return reply.code(400).send({ message: 'Cannot leave your personal workspace.' });
    }

    if (membership.member.role === 'OWNER') {
      const ownerCount = await prisma.workspaceMember.count({
        where: {
          workspaceId,
          role: 'OWNER',
        },
      });
      if (ownerCount <= 1) {
        return reply
          .code(400)
          .send({ message: 'Workspace must always have at least one owner.' });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({
        where: {
          userId: request.user.sub,
          team: { workspaceId },
        },
      });
      await tx.repoMember.deleteMany({
        where: {
          userId: request.user.sub,
          repo: { workspaceId },
        },
      });
      await tx.workspaceMember.delete({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: request.user.sub,
          },
        },
      });
    });

    return reply.send({ ok: true });
  });

  server.get('/workspaces/:workspaceId/invites', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }
    const actorRole = membership.member?.role ?? 'MEMBER';

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, isPersonal: true, invitePolicy: true },
    });
    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }
    if (workspace.isPersonal) {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces do not support invites.' });
    }
    if (!canRoleManageInvites(actorRole, workspace.invitePolicy)) {
      return reply.code(403).send({ message: 'Insufficient permissions.' });
    }

    const now = new Date();
    await prisma.workspaceInvite.updateMany({
      where: {
        workspaceId,
        status: 'PENDING',
        expiresAt: { lte: now },
      },
      data: {
        status: 'EXPIRED',
        respondedAt: now,
      },
    });

    const invites = await prisma.workspaceInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        status: true,
        invitedEmail: true,
        invitedUsername: true,
        invitedUserId: true,
        message: true,
        expiresAt: true,
        respondedAt: true,
        createdAt: true,
        invitedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
        invitedUser: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
        acceptedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return { invites };
  });

  server.post('/workspaces/:workspaceId/invites', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };
    const body = workspaceInviteSchema.parse(request.body);

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }
    const actorRole = membership.member?.role ?? 'MEMBER';

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        isPersonal: true,
        invitePolicy: true,
      },
    });
    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }
    if (workspace.isPersonal) {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces do not support invites.' });
    }
    if (!canRoleManageInvites(actorRole, workspace.invitePolicy)) {
      return reply.code(403).send({ message: 'Insufficient permissions.' });
    }

    if (body.role === 'OWNER' && actorRole !== 'OWNER') {
      return reply
        .code(403)
        .send({ message: 'Only workspace owners can invite another owner.' });
    }
    if (body.role === 'ADMIN' && actorRole === 'MEMBER') {
      return reply
        .code(403)
        .send({ message: 'Members can only invite with the Member role.' });
    }

    let target: ReturnType<typeof parseWorkspaceInviteTarget>;
    try {
      target = parseWorkspaceInviteTarget(body.identifier);
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error ? error.message : 'Invalid invite target.',
      });
    }
    const normalizedMessage = body.message?.trim() || null;
    const now = new Date();

    const targetUser =
      target.type === 'email'
        ? await prisma.user.findFirst({
            where: {
              email: { equals: target.value, mode: 'insensitive' },
            },
            select: { id: true, email: true, username: true, name: true },
          })
        : await prisma.user.findFirst({
            where: {
              username: { equals: target.value, mode: 'insensitive' },
            },
            select: { id: true, email: true, username: true, name: true },
          });

    if (!targetUser) {
      return reply.code(404).send({
        message: 'User not found. Invites can only be sent to existing accounts.',
      });
    }

    const invitedEmail =
      target.type === 'email'
        ? target.value
        : targetUser.email?.toLowerCase() ?? null;
    const invitedUsername =
      target.type === 'username'
        ? target.value
        : targetUser.username?.toLowerCase() ?? null;

    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUser.id,
        },
      },
      select: { id: true },
    });
    if (existingMember) {
      return reply
        .code(409)
        .send({ message: 'User is already a workspace member.' });
    }

    const pendingMatchFilters: Prisma.WorkspaceInviteWhereInput[] = [];
    pendingMatchFilters.push({ invitedUserId: targetUser.id });
    if (invitedEmail) {
      pendingMatchFilters.push({
        invitedEmail: { equals: invitedEmail, mode: 'insensitive' },
      });
    }
    if (invitedUsername) {
      pendingMatchFilters.push({
        invitedUsername: { equals: invitedUsername, mode: 'insensitive' },
      });
    }

    if (pendingMatchFilters.length) {
      const existingPendingInvite = await prisma.workspaceInvite.findFirst({
        where: {
          workspaceId,
          status: 'PENDING',
          OR: pendingMatchFilters,
        },
        select: {
          id: true,
          expiresAt: true,
        },
      });

      if (existingPendingInvite) {
        if (!isInviteExpired(existingPendingInvite.expiresAt)) {
          return reply.code(409).send({
            message: 'An active invite already exists for this user.',
          });
        }
        await prisma.workspaceInvite.update({
          where: { id: existingPendingInvite.id },
          data: {
            status: 'EXPIRED',
            respondedAt: now,
          },
        });
      }
    }

    const token = generateWorkspaceInviteToken();
    const tokenHash = hashWorkspaceInviteToken(token);
    const expiresInHours = Number.parseInt(
      process.env.WORKSPACE_INVITE_EXPIRES_HOURS ?? '168',
      10,
    );

    const invite = await prisma.workspaceInvite.create({
      data: {
        workspaceId,
        invitedById: request.user.sub,
        invitedUserId: targetUser?.id ?? null,
        invitedEmail,
        invitedUsername,
        role: body.role ?? 'MEMBER',
        status: 'PENDING',
        tokenHash,
        tokenPrefix: getWorkspaceInviteTokenPrefix(token),
        message: normalizedMessage,
        expiresAt: getWorkspaceInviteExpiryDate(expiresInHours),
      },
      select: {
        id: true,
        role: true,
        status: true,
        invitedEmail: true,
        invitedUsername: true,
        invitedUserId: true,
        message: true,
        expiresAt: true,
        createdAt: true,
        invitedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
        invitedUser: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const webBaseUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
    const inviteUrl = `${webBaseUrl}/invites/${encodeURIComponent(token)}`;
    if (targetUser.id !== request.user.sub) {
      const actorLabel =
        invite.invitedBy.name ||
        invite.invitedBy.username ||
        invite.invitedBy.email ||
        'A workspace admin';
      try {
        await prisma.notification.create({
          data: {
            recipientId: targetUser.id,
            actorId: request.user.sub,
            type: 'INVITE',
            title: `Workspace invite: ${workspace.name}`,
            body: `${actorLabel} invited you as ${invite.role}. Open this link to accept: ${inviteUrl}`,
            workspaceId: workspace.id,
          },
        });
      } catch (notificationError) {
        request.log.warn(
          { error: notificationError, workspaceId: workspace.id, recipientId: targetUser.id },
          'Unable to create workspace invite notification.',
        );
      }
    }

    if (invitedEmail) {
      const invitedByLabel =
        invite.invitedBy.name ||
        invite.invitedBy.username ||
        invite.invitedBy.email ||
        'A workspace admin';
      try {
        await sendWorkspaceInviteEmail({
          toEmail: invitedEmail,
          workspaceName: workspace.name,
          workspaceSlug: workspace.slug,
          inviteUrl,
          invitedBy: invitedByLabel,
          role: invite.role,
          message: invite.message,
        });
      } catch (emailError) {
        request.log.warn(
          { error: emailError, workspaceId: workspace.id, invitedEmail },
          'Unable to deliver workspace invite email.',
        );
      }
    }
    return reply.code(201).send({
      invite,
      inviteUrl,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
    });
  });

  server.delete(
    '/workspaces/:workspaceId/invites/:inviteId',
    async (request, reply) => {
      await request.jwtVerify();
      const params = workspaceInviteParamsSchema.parse(request.params);

      const membership = await requireWorkspaceMember(params.workspaceId, request.user.sub);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }
      const actorRole = membership.member?.role ?? 'MEMBER';

      const workspace = await prisma.workspace.findUnique({
        where: { id: params.workspaceId },
        select: { id: true, isPersonal: true, invitePolicy: true },
      });
      if (!workspace) {
        return reply.code(404).send({ message: 'Workspace not found.' });
      }
      if (workspace.isPersonal) {
        return reply
          .code(400)
          .send({ message: 'Personal workspaces do not support invites.' });
      }
      if (!canRoleManageInvites(actorRole, workspace.invitePolicy)) {
        return reply.code(403).send({ message: 'Insufficient permissions.' });
      }

      const invite = await prisma.workspaceInvite.findFirst({
        where: {
          id: params.inviteId,
          workspaceId: params.workspaceId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!invite) {
        return reply.code(404).send({ message: 'Invite not found.' });
      }
      if (invite.status !== 'PENDING') {
        return reply
          .code(409)
          .send({ message: 'Only pending invites can be cancelled.' });
      }

      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: 'CANCELLED',
          respondedAt: new Date(),
        },
      });

      return reply.send({ ok: true });
    },
  );

  server.get('/workspace-invites', async (request, reply) => {
    await request.jwtVerify();
    const viewer = await resolveInviteViewer(request.user.sub);
    if (!viewer) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const recipientFilters = buildInviteRecipientFilters(viewer);
    const now = new Date();

    await prisma.workspaceInvite.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lte: now },
        OR: recipientFilters,
      },
      data: {
        status: 'EXPIRED',
        respondedAt: now,
      },
    });

    const invites = await prisma.workspaceInvite.findMany({
      where: {
        OR: recipientFilters,
        status: {
          in: ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'],
        },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        role: true,
        status: true,
        invitedEmail: true,
        invitedUsername: true,
        invitedUserId: true,
        message: true,
        expiresAt: true,
        respondedAt: true,
        createdAt: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            isPersonal: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return { invites };
  });

  server.post('/workspace-invites/:inviteId/accept', async (request, reply) => {
    await request.jwtVerify();
    const { inviteId } = request.params as { inviteId: string };

    const viewer = await resolveInviteViewer(request.user.sub);
    if (!viewer) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        workspaceId: true,
        invitedById: true,
        role: true,
        status: true,
        invitedUserId: true,
        invitedEmail: true,
        invitedUsername: true,
        expiresAt: true,
        workspace: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!invite || !inviteMatchesViewer(invite, viewer)) {
      return reply.code(404).send({ message: 'Invite not found.' });
    }

    if (invite.status !== 'PENDING') {
      if (invite.status === 'ACCEPTED') {
        const member = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: invite.workspaceId,
              userId: viewer.id,
            },
          },
          select: { id: true, role: true },
        });
        return reply.send({ ok: true, alreadyAccepted: true, member });
      }
      return reply.code(409).send({ message: 'Invite is no longer pending.' });
    }

    if (isInviteExpired(invite.expiresAt)) {
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: 'EXPIRED',
          respondedAt: new Date(),
        },
      });
      return reply.code(410).send({ message: 'Invite expired.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId: viewer.id,
          },
        },
        update: {},
        create: {
          workspaceId: invite.workspaceId,
          userId: viewer.id,
          role: invite.role,
        },
        select: {
          id: true,
          role: true,
        },
      });

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          acceptedById: viewer.id,
          invitedUserId: viewer.id,
        },
      });

      return member;
    });

    if (invite.invitedById && invite.invitedById !== viewer.id) {
      const viewerLabel = formatInviteViewerLabel(viewer);
      try {
        await prisma.notification.create({
          data: {
            recipientId: invite.invitedById,
            actorId: viewer.id,
            type: 'INVITE',
            title: `Invite accepted: ${invite.workspace.name}`,
            body: `${viewerLabel} accepted your workspace invite.`,
            workspaceId: invite.workspaceId,
          },
        });
      } catch (notificationError) {
        request.log.warn(
          { error: notificationError, workspaceId: invite.workspaceId, recipientId: invite.invitedById },
          'Unable to create invite accepted notification.',
        );
      }
    }

    return reply.send({ ok: true, member: result });
  });

  server.post('/workspace-invites/:inviteId/decline', async (request, reply) => {
    await request.jwtVerify();
    const { inviteId } = request.params as { inviteId: string };

    const viewer = await resolveInviteViewer(request.user.sub);
    if (!viewer) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const invite = await prisma.workspaceInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        workspaceId: true,
        invitedById: true,
        status: true,
        invitedUserId: true,
        invitedEmail: true,
        invitedUsername: true,
        workspace: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!invite || !inviteMatchesViewer(invite, viewer)) {
      return reply.code(404).send({ message: 'Invite not found.' });
    }

    if (invite.status !== 'PENDING') {
      return reply.code(409).send({ message: 'Invite is no longer pending.' });
    }

    await prisma.workspaceInvite.update({
      where: { id: invite.id },
      data: {
        status: 'DECLINED',
        respondedAt: new Date(),
        invitedUserId: viewer.id,
      },
    });

    if (invite.invitedById && invite.invitedById !== viewer.id) {
      const viewerLabel = formatInviteViewerLabel(viewer);
      try {
        await prisma.notification.create({
          data: {
            recipientId: invite.invitedById,
            actorId: viewer.id,
            type: 'INVITE',
            title: `Invite declined: ${invite.workspace.name}`,
            body: `${viewerLabel} declined your workspace invite.`,
            workspaceId: invite.workspaceId,
          },
        });
      } catch (notificationError) {
        request.log.warn(
          { error: notificationError, workspaceId: invite.workspaceId, recipientId: invite.invitedById },
          'Unable to create invite declined notification.',
        );
      }
    }

    return reply.send({ ok: true });
  });

  server.get('/workspace-invites/token/:token', async (request, reply) => {
    const params = workspaceInviteTokenParamsSchema.parse(request.params);
    const invite = await prisma.workspaceInvite.findUnique({
      where: {
        tokenHash: hashWorkspaceInviteToken(params.token),
      },
      select: {
        id: true,
        role: true,
        status: true,
        message: true,
        invitedEmail: true,
        invitedUsername: true,
        invitedUserId: true,
        expiresAt: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            isPersonal: true,
          },
        },
        invitedBy: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!invite) {
      return reply.code(404).send({ message: 'Invite not found.' });
    }

    const viewerId = await getOptionalUserId(request);
    const viewer = viewerId ? await resolveInviteViewer(viewerId) : null;

    const expired = isInviteExpired(invite.expiresAt);
    const canClaim = viewer ? inviteMatchesViewer(invite, viewer) : false;

    return {
      invite: {
        id: invite.id,
        role: invite.role,
        status: invite.status,
        message: invite.message,
        invitedEmail: invite.invitedEmail,
        invitedUsername: invite.invitedUsername,
        expiresAt: invite.expiresAt,
        workspace: invite.workspace,
        invitedBy: invite.invitedBy,
      },
      viewer: viewer
        ? {
            id: viewer.id,
            email: viewer.email,
            username: viewer.username,
            canClaim,
          }
        : null,
      expired,
    };
  });

  server.post('/workspace-invites/token/:token/accept', async (request, reply) => {
    await request.jwtVerify();
    const params = workspaceInviteTokenParamsSchema.parse(request.params);

    const viewer = await resolveInviteViewer(request.user.sub);
    if (!viewer) {
      return reply.code(404).send({ message: 'User not found.' });
    }

    const invite = await prisma.workspaceInvite.findUnique({
      where: {
        tokenHash: hashWorkspaceInviteToken(params.token),
      },
      select: {
        id: true,
        workspaceId: true,
        invitedById: true,
        role: true,
        status: true,
        invitedUserId: true,
        invitedEmail: true,
        invitedUsername: true,
        expiresAt: true,
        workspace: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!invite || !inviteMatchesViewer(invite, viewer)) {
      return reply.code(404).send({ message: 'Invite not found.' });
    }

    if (invite.status !== 'PENDING') {
      return reply.code(409).send({ message: 'Invite is no longer pending.' });
    }

    if (isInviteExpired(invite.expiresAt)) {
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: 'EXPIRED',
          respondedAt: new Date(),
        },
      });
      return reply.code(410).send({ message: 'Invite expired.' });
    }

    const membership = await prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: invite.workspaceId,
            userId: viewer.id,
          },
        },
        update: {},
        create: {
          workspaceId: invite.workspaceId,
          userId: viewer.id,
          role: invite.role,
        },
        select: {
          id: true,
          role: true,
        },
      });

      await tx.workspaceInvite.update({
        where: { id: invite.id },
        data: {
          status: 'ACCEPTED',
          respondedAt: new Date(),
          acceptedById: viewer.id,
          invitedUserId: viewer.id,
        },
      });

      return member;
    });

    if (invite.invitedById && invite.invitedById !== viewer.id) {
      const viewerLabel = formatInviteViewerLabel(viewer);
      try {
        await prisma.notification.create({
          data: {
            recipientId: invite.invitedById,
            actorId: viewer.id,
            type: 'INVITE',
            title: `Invite accepted: ${invite.workspace.name}`,
            body: `${viewerLabel} accepted your workspace invite.`,
            workspaceId: invite.workspaceId,
          },
        });
      } catch (notificationError) {
        request.log.warn(
          { error: notificationError, workspaceId: invite.workspaceId, recipientId: invite.invitedById },
          'Unable to create token invite accepted notification.',
        );
      }
    }

    return reply.send({ ok: true, member: membership });
  });

  server.get('/workspaces/:workspaceId/teams', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const teams = await prisma.team.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        _count: {
          select: {
            members: true,
            repoPermissions: true,
          },
        },
      },
    });

    return {
      teams: teams.map((team) => ({
        id: team.id,
        name: team.name,
        slug: team.slug,
        memberCount: team._count.members,
        repoGrantCount: team._count.repoPermissions,
      })),
    };
  });

  server.post('/workspaces/:workspaceId/teams', async (request, reply) => {
    await request.jwtVerify();
    const body = createTeamSchema.parse(request.body);
    const teamName = normalizeDisplayName(body.name);
    const teamNameError = validateTeamName(teamName);
    if (teamNameError) {
      return reply.code(400).send({ message: teamNameError });
    }
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const slug = toSlug(body.slug?.trim() || teamName);
    const slugError = validateRouteSlug(slug);
    if (slugError) {
      return reply
        .code(400)
        .send({ message: `Invalid team slug. ${slugError}` });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPersonal: true },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal) {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces cannot have teams.' });
    }

    try {
      const team = await prisma.team.create({
        data: {
          workspaceId,
          name: teamName,
          slug,
          members: {
            create: {
              userId: request.user.sub,
            },
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });

      return reply.code(201).send({ team });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ message: 'Team slug already exists.' });
        }
      }
      throw error;
    }
  });

  server.delete('/workspaces/:workspaceId/teams/:teamId', async (request, reply) => {
    await request.jwtVerify();
    const params = teamParamsSchema.parse(request.params);

    const membership = await requireWorkspaceMember(params.workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const team = await prisma.team.findFirst({
      where: { id: params.teamId, workspaceId: params.workspaceId },
      select: { id: true, name: true },
    });
    if (!team) {
      return reply.code(404).send({ message: 'Team not found.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.teamRepoPermission.deleteMany({
        where: { teamId: team.id },
      });
      await tx.teamMember.deleteMany({
        where: { teamId: team.id },
      });
      await tx.team.delete({
        where: { id: team.id },
      });
    });

    return reply.send({ ok: true });
  });

  server.get('/workspaces/:workspaceId/teams/:teamId/members', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId, teamId } = request.params as {
      workspaceId: string;
      teamId: string;
    };

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const team = await prisma.team.findFirst({
      where: { id: teamId, workspaceId },
      select: { id: true, name: true },
    });

    if (!team) {
      return reply.code(404).send({ message: 'Team not found.' });
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return { members };
  });

  server.post('/workspaces/:workspaceId/teams/:teamId/members', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId, teamId } = request.params as {
      workspaceId: string;
      teamId: string;
    };
    const body = teamMemberSchema.parse(request.body);

    const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
      'OWNER',
      'ADMIN',
    ]);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }
    const resolvedWorkspaceId = membership.workspaceId;
    if (!resolvedWorkspaceId) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: resolvedWorkspaceId },
      select: { id: true, name: true, slug: true, isPersonal: true },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal) {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces cannot have teams.' });
    }

    const team = await prisma.team.findFirst({
      where: { id: teamId, workspaceId: resolvedWorkspaceId },
      select: { id: true, name: true },
    });

    if (!team) {
      return reply.code(404).send({ message: 'Team not found.' });
    }

    const workspaceMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: resolvedWorkspaceId,
          userId: body.userId,
        },
      },
      select: {
        id: true,
        user: {
          select: { id: true, email: true, name: true, username: true },
        },
      },
    });

    if (!workspaceMember) {
      return reply
        .code(400)
        .send({ message: 'Add this user to People first.' });
    }

    const user = workspaceMember.user;

    try {
      const member = await prisma.teamMember.create({
        data: {
          teamId,
          userId: body.userId,
          role: 'MEMBER',
        },
        select: {
          id: true,
          createdAt: true,
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      if (user.id !== request.user.sub) {
        try {
          await prisma.notification.create({
            data: {
              recipientId: user.id,
              actorId: request.user.sub,
              type: 'SYSTEM',
              title: `Added to team: ${team.name}`,
              body: `You were added to team ${team.name} in workspace ${workspace.name}.`,
              workspaceId: resolvedWorkspaceId,
            },
          });
        } catch (notificationError) {
          request.log.warn(
            { error: notificationError, workspaceId: resolvedWorkspaceId, recipientId: user.id },
            'Unable to create team membership notification.',
          );
        }
      }

      return reply.code(201).send({ member });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply
            .code(409)
            .send({ message: 'User is already on this team.' });
        }
      }
      throw error;
    }
  });

  server.delete(
    '/workspaces/:workspaceId/teams/:teamId/members/:userId',
    async (request, reply) => {
      await request.jwtVerify();
      const { workspaceId, teamId, userId } = request.params as {
        workspaceId: string;
        teamId: string;
        userId: string;
      };

      const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
        'OWNER',
        'ADMIN',
      ]);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }

      const team = await prisma.team.findFirst({
        where: { id: teamId, workspaceId },
        select: { id: true },
      });

      if (!team) {
        return reply.code(404).send({ message: 'Team not found.' });
      }

      const existing = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({ message: 'Team member not found.' });
      }

      await prisma.teamMember.delete({
        where: { id: existing.id },
      });

      return reply.send({ ok: true });
    },
  );

  server.get(
    '/workspaces/:workspaceId/teams/:teamId/repos',
    async (request, reply) => {
      await request.jwtVerify();
      const { workspaceId, teamId } = request.params as {
        workspaceId: string;
        teamId: string;
      };

      const membership = await requireWorkspaceMember(workspaceId, request.user.sub);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }

      const team = await prisma.team.findFirst({
        where: { id: teamId, workspaceId },
        select: { id: true, name: true, slug: true },
      });

      if (!team) {
        return reply.code(404).send({ message: 'Team not found.' });
      }

      const grants = await prisma.teamRepoPermission.findMany({
        where: {
          teamId: team.id,
          repo: { workspaceId },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          createdAt: true,
          repo: {
            select: {
              id: true,
              name: true,
              slug: true,
              visibility: true,
              defaultBranch: true,
            },
          },
        },
      });

      return reply.send({ team, grants });
    },
  );

  server.put(
    '/workspaces/:workspaceId/teams/:teamId/repos/:repoId',
    async (request, reply) => {
      await request.jwtVerify();
      const { workspaceId, teamId, repoId } = request.params as {
        workspaceId: string;
        teamId: string;
        repoId: string;
      };
      const body = teamRepoPermissionSchema.parse(request.body);

      const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
        'OWNER',
        'ADMIN',
      ]);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }
      const canonicalWorkspaceId = membership.workspaceId;
      if (!canonicalWorkspaceId) {
        return reply.code(403).send({ message: 'Not a member of this workspace.' });
      }

      const workspace = await prisma.workspace.findUnique({
        where: { id: canonicalWorkspaceId },
        select: { isPersonal: true },
      });

      if (!workspace) {
        return reply.code(404).send({ message: 'Workspace not found.' });
      }

      if (workspace.isPersonal) {
        return reply
          .code(400)
          .send({ message: 'Personal workspaces cannot have teams.' });
      }

      const team = await prisma.team.findFirst({
        where: { id: teamId, workspaceId: canonicalWorkspaceId },
        select: { id: true },
      });

      if (!team) {
        return reply.code(404).send({ message: 'Team not found.' });
      }

      const repo = await prisma.repo.findFirst({
        where: {
          workspaceId: canonicalWorkspaceId,
          OR: [{ id: repoId }, { slug: repoId }],
        },
        select: { id: true },
      });

      if (!repo) {
        return reply.code(404).send({ message: 'Repo not found.' });
      }

      const permission = await prisma.teamRepoPermission.upsert({
        where: {
          teamId_repoId: {
            teamId,
            repoId: repo.id,
          },
        },
        update: { role: body.role },
        create: {
          teamId,
          repoId: repo.id,
          role: body.role,
        },
        select: {
          id: true,
          role: true,
        },
      });

      return reply.send({ permission });
    },
  );

  server.delete(
    '/workspaces/:workspaceId/teams/:teamId/repos/:repoId',
    async (request, reply) => {
      await request.jwtVerify();
      const { workspaceId, teamId, repoId } = request.params as {
        workspaceId: string;
        teamId: string;
        repoId: string;
      };

      const membership = await requireWorkspaceMember(workspaceId, request.user.sub, [
        'OWNER',
        'ADMIN',
      ]);
      if (membership.error) {
        return reply.code(403).send({ message: membership.error });
      }

      const permission = await prisma.teamRepoPermission.findUnique({
        where: {
          teamId_repoId: {
            teamId,
            repoId,
          },
        },
        select: { id: true },
      });

      if (!permission) {
        return reply.code(404).send({ message: 'Team permission not found.' });
      }

      await prisma.teamRepoPermission.delete({
        where: { id: permission.id },
      });

      return reply.send({ ok: true });
    },
  );

  server.get('/workspaces/:workspaceId/repos', async (request, reply) => {
    const userId = await requireAuthenticatedUserId(request);
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slug: true },
    });
    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    const repos = await prisma.repo.findMany({
      where: { workspaceId },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        slug: true,
        description: true,
        visibility: true,
        publicReadRequiresAuth: true,
        defaultBranch: true,
        forkedFromRepoId: true,
        forkedFrom: {
          select: {
            id: true,
            name: true,
            slug: true,
            workspaceId: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const reposWithLanguages = await Promise.all(
      repos.map(async (repo) => {
        const cleanDefaultBranch = sanitizeBranchRef(repo.defaultBranch || 'main');
        try {
          const repoDir = await getRepoDir(repoRoot, workspace.slug, repo.slug);
          const summary = await getRepoLanguageSummary(
            repoDir,
            cleanDefaultBranch,
          );
          return {
            ...repo,
            defaultBranch: cleanDefaultBranch,
            languageBytes: summary.totalBytes,
            languages: summary.languages,
          };
        } catch {
          return {
            ...repo,
            defaultBranch: cleanDefaultBranch,
            languageBytes: 0,
            languages: [],
          };
        }
      }),
    );

    return {
      repos: reposWithLanguages.map((repo) => ({
        ...repo,
        workspaceId: repo.workspaceId,
        forkedFrom: repo.forkedFrom
          ? {
              ...repo.forkedFrom,
              workspaceId: repo.forkedFrom.workspaceId,
              workspace: repo.forkedFrom.workspace,
            }
          : null,
      })),
    };
  });

  server.get('/workspaces/:workspaceId/repos/:repoId', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const { access, userId } = accessResult;
    const repo = access.repo;
    const viewerRole =
      access.role ??
      (repo.visibility === 'PUBLIC' &&
      (!repo.publicReadRequiresAuth || Boolean(userId))
        ? 'READ'
        : null);
    const viewerRoleSource = access.source
      ? access.source.type === 'TEAM_GRANT'
        ? {
            type: access.source.type,
            teamId: access.source.teamId,
            teamName: access.source.teamName,
          }
        : {
            type: access.source.type,
          }
      : viewerRole === 'READ' && repo.visibility === 'PUBLIC'
        ? { type: 'PUBLIC_VISIBILITY' as const }
        : null;
    const forkMeta = await prisma.repo.findUnique({
      where: { id: repo.id },
      select: {
        forkedFromRepoId: true,
        forkedFrom: {
          select: {
            id: true,
            name: true,
            slug: true,
            workspaceId: true,
            workspace: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const cleanDefaultBranch = sanitizeBranchRef(repo.defaultBranch || 'main');
    const languageSummary = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug)
      .then((repoDir) => getRepoLanguageSummary(repoDir, cleanDefaultBranch))
      .catch(() => ({ totalBytes: 0, languages: [] }));

    return {
      repo: {
        id: repo.id,
        workspaceId: repo.workspace.id,
        name: repo.name,
        slug: repo.slug,
        description: repo.description,
        visibility: repo.visibility,
        publicReadRequiresAuth: repo.publicReadRequiresAuth,
        defaultBranch: cleanDefaultBranch,
        forkedFromRepoId: forkMeta?.forkedFromRepoId ?? null,
        forkedFrom: forkMeta?.forkedFrom
          ? {
              ...forkMeta.forkedFrom,
              workspaceId: forkMeta.forkedFrom.workspaceId,
              workspace: forkMeta.forkedFrom.workspace,
            }
          : null,
        workspace: {
          id: repo.workspace.id,
          name: repo.workspace.name,
          slug: repo.workspace.slug,
          isPersonal: repo.workspace.isPersonal,
        },
        viewerRole,
        viewerRoleSource,
        languageBytes: languageSummary.totalBytes,
        languages: languageSummary.languages,
      },
    };
  });

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/automation-tokens',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const tokens = await prisma.repoAutomationToken.findMany({
        where: { repoId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          scopes: true,
          lastUsedAt: true,
          revokedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ tokens });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/webhook-secret',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const { secret, record } = await upsertWebhookSecret(repoId);
      return reply.code(201).send({ secret, record });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/webhooks',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const hooks = await prisma.repoWebhook.findMany({
        where: { repoId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          repoId: true,
          name: true,
          url: true,
          active: true,
          events: true,
          maxAttempts: true,
          timeoutMs: true,
          lastDeliveryAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ webhooks: hooks });
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/webhooks/deliveries',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const query = repoWebhookDeliveriesQuerySchema.parse(request.query ?? {});

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const deliveries = await prisma.repoWebhookDelivery.findMany({
        where: {
          webhook: {
            repoId,
          },
          webhookId: query.webhookId,
          status: query.status,
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 100,
        select: {
          id: true,
          webhookId: true,
          eventType: true,
          status: true,
          payload: true,
          attemptCount: true,
          maxAttempts: true,
          nextAttemptAt: true,
          responseStatus: true,
          responseBody: true,
          error: true,
          deliveredAt: true,
          createdAt: true,
          updatedAt: true,
          webhook: {
            select: {
              name: true,
              url: true,
            },
          },
        },
      });

      return reply.send({ deliveries });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/webhooks',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = createRepoWebhookSchema.parse(request.body ?? {});

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const webhook = await prisma.repoWebhook.create({
        data: {
          repoId,
          name: body.name.trim(),
          url: body.url.trim(),
          events: Array.from(new Set(body.events)),
          active: body.active ?? true,
          maxAttempts: body.maxAttempts,
          timeoutMs: body.timeoutMs,
        },
        select: {
          id: true,
          repoId: true,
          name: true,
          url: true,
          active: true,
          events: true,
          maxAttempts: true,
          timeoutMs: true,
          lastDeliveryAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.code(201).send({ webhook });
    },
  );

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/webhooks/:webhookId',
    async (request, reply) => {
      const params = repoWebhookParamsSchema.parse(request.params);
      const body = updateRepoWebhookSchema.parse(request.body ?? {});

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId: params.workspaceId,
        repoId: params.repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const existing = await prisma.repoWebhook.findFirst({
        where: {
          id: params.webhookId,
          repoId: params.repoId,
        },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Webhook not found.' });
      }

      const webhook = await prisma.repoWebhook.update({
        where: { id: existing.id },
        data: {
          name: body.name?.trim(),
          url: body.url?.trim(),
          events: body.events ? Array.from(new Set(body.events)) : undefined,
          active: body.active,
          maxAttempts: body.maxAttempts,
          timeoutMs: body.timeoutMs,
        },
        select: {
          id: true,
          repoId: true,
          name: true,
          url: true,
          active: true,
          events: true,
          maxAttempts: true,
          timeoutMs: true,
          lastDeliveryAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return reply.send({ webhook });
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/webhooks/:webhookId',
    async (request, reply) => {
      const params = repoWebhookParamsSchema.parse(request.params);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId: params.workspaceId,
        repoId: params.repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const existing = await prisma.repoWebhook.findFirst({
        where: {
          id: params.webhookId,
          repoId: params.repoId,
        },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Webhook not found.' });
      }

      await prisma.repoWebhook.delete({
        where: { id: existing.id },
      });

      return reply.send({ deleted: true });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/automation-tokens',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = automationTokenSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const scopes = normalizeAutomationScopes(body.scopes);
      const { token, record } = await createRepoAutomationToken({
        repoId,
        name: body.name,
        scopes,
      });

      return reply.code(201).send({ token, tokenInfo: record });
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/automation-tokens/:tokenId',
    async (request, reply) => {
      const params = automationTokenParamsSchema.parse(request.params);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId: params.workspaceId,
        repoId: params.repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const existing = await prisma.repoAutomationToken.findFirst({
        where: {
          id: params.tokenId,
          repoId: params.repoId,
        },
        select: {
          id: true,
          revokedAt: true,
        },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Token not found.' });
      }

      if (!existing.revokedAt) {
        await prisma.repoAutomationToken.update({
          where: { id: existing.id },
          data: { revokedAt: new Date() },
        });
      }

      return reply.send({ revoked: true });
    },
  );

  server.patch('/workspaces/:workspaceId/repos/:repoId', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = updateRepoSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'ADMIN',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    if (!Object.keys(body).length) {
      return reply.code(400).send({ message: 'No updates provided.' });
    }

    const nextRepoName =
      body.name !== undefined ? normalizeDisplayName(body.name) : undefined;
    if (nextRepoName !== undefined) {
      const repoNameError = validateRepoName(nextRepoName);
      if (repoNameError) {
        return reply.code(400).send({ message: repoNameError });
      }
    }

    const repo = accessResult.access.repo;
    if (repo.workspace.isPersonal && body.visibility === 'INTERNAL') {
      return reply
        .code(400)
        .send({
          message: 'Personal workspaces cannot use internal visibility.',
        });
    }

    const hasSlugInput = body.slug !== undefined;
    const nextSlug = hasSlugInput ? toSlug(body.slug.trim()) : undefined;
    if (hasSlugInput) {
      const slugError = validateRouteSlug(nextSlug ?? '');
      if (slugError) {
        return reply
          .code(400)
          .send({ message: `Invalid repository slug. ${slugError}` });
      }
    }

    const slugChanged = Boolean(hasSlugInput && nextSlug !== repo.slug);
    if (slugChanged && nextSlug) {
      const existingRepo = await prisma.repo.findFirst({
        where: {
          workspaceId: repo.workspaceId,
          slug: nextSlug,
          id: { not: repo.id },
        },
        select: { id: true },
      });
      if (existingRepo) {
        return reply.code(409).send({ message: 'Repo slug already exists.' });
      }
    }

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const currentRepoDir = path.join(repoRoot, repo.workspace.slug, `${repo.slug}.git`);
    const nextRepoDir = path.join(repoRoot, repo.workspace.slug, `${nextSlug ?? repo.slug}.git`);
    let movedRepoDir = false;

    try {
      if (slugChanged) {
        movedRepoDir = await renamePathIfExists(currentRepoDir, nextRepoDir);
      }
    } catch (error) {
      if (error instanceof PathConflictError) {
        return reply
          .code(409)
          .send({ message: 'Repo slug path already exists on disk.' });
      }
      throw error;
    }

    let updated: {
      id: string;
      name: string;
      slug: string;
      description: string | null;
      visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
      publicReadRequiresAuth: boolean;
      defaultBranch: string;
    };

    try {
      updated = await prisma.repo.update({
        where: { id: repo.id },
        data: {
          name: nextRepoName,
          slug: nextSlug ?? undefined,
          description: normalizeRepoDescription(body.description),
          visibility: body.visibility,
          publicReadRequiresAuth: body.publicReadRequiresAuth,
          defaultBranch:
            body.defaultBranch !== undefined
              ? sanitizeBranchRef(body.defaultBranch)
              : undefined,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          visibility: true,
          publicReadRequiresAuth: true,
          defaultBranch: true,
        },
      });
    } catch (error) {
      if (movedRepoDir) {
        try {
          await renamePathIfExists(nextRepoDir, currentRepoDir);
        } catch {
          // Best effort rollback only.
        }
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.code(409).send({ message: 'Repo slug already exists.' });
      }
      throw error;
    }

    return {
      repo: {
        ...updated,
        defaultBranch: sanitizeBranchRef(updated.defaultBranch),
        workspaceId,
      },
    };
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/labels', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const labels = await prisma.repoLabel.findMany({
      where: { repoId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            issueLinks: true,
            pullLinks: true,
          },
        },
      },
    });

    return {
      labels: labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        description: label.description,
        createdAt: label.createdAt,
        updatedAt: label.updatedAt,
        issueCount: label._count.issueLinks,
        pullCount: label._count.pullLinks,
      })),
    };
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/labels', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = createRepoLabelSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const normalizedName = normalizeLabelName(body.name);
    if (!normalizedName) {
      return reply.code(400).send({ message: 'Label name is required.' });
    }

    try {
      const label = await prisma.repoLabel.create({
        data: {
          repoId,
          name: normalizedName,
          nameKey: toLabelKey(normalizedName),
          color: body.color ?? pickLabelColor(normalizedName),
          description: body.description?.trim() || null,
        },
        select: {
          id: true,
          name: true,
          color: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return reply.code(201).send({ label });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return reply
          .code(409)
          .send({ message: 'A label with this name already exists.' });
      }
      throw error;
    }
  });

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/labels/:labelId',
    async (request, reply) => {
      const { workspaceId, repoId, labelId } = request.params as {
        workspaceId: string;
        repoId: string;
        labelId: string;
      };
      const body = updateRepoLabelSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const existing = await prisma.repoLabel.findFirst({
        where: {
          id: labelId,
          repoId,
        },
        select: { id: true, name: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Label not found.' });
      }

      const nextName =
        body.name !== undefined ? normalizeLabelName(body.name) : existing.name;
      if (!nextName) {
        return reply.code(400).send({ message: 'Label name is required.' });
      }

      try {
        const label = await prisma.repoLabel.update({
          where: { id: labelId },
          data: {
            name: nextName,
            nameKey: toLabelKey(nextName),
            color: body.color,
            description:
              body.description !== undefined
                ? body.description.trim() || null
                : undefined,
          },
          select: {
            id: true,
            name: true,
            color: true,
            description: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return { label };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return reply
            .code(409)
            .send({ message: 'A label with this name already exists.' });
        }
        throw error;
      }
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/labels/:labelId',
    async (request, reply) => {
      const { workspaceId, repoId, labelId } = request.params as {
        workspaceId: string;
        repoId: string;
        labelId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const existing = await prisma.repoLabel.findFirst({
        where: {
          id: labelId,
          repoId,
        },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Label not found.' });
      }

      await prisma.repoLabel.delete({
        where: { id: labelId },
      });
      return { ok: true };
    },
  );

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/notification-preferences',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const userId = accessResult.userId ?? request.user.sub;
      const preference = await prisma.repoNotificationPreference.findUnique({
        where: {
          userId_repoId: {
            userId,
            repoId,
          },
        },
        select: {
          id: true,
          mode: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        preference: {
          id: preference?.id ?? null,
          userId,
          repoId,
          mode: preference?.mode ?? 'DEFAULT',
          createdAt: preference?.createdAt ?? null,
          updatedAt: preference?.updatedAt ?? null,
        },
      };
    },
  );

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/notification-preferences',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = updateRepoNotificationPreferenceSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const userId = accessResult.userId ?? request.user.sub;
      if (body.mode === 'DEFAULT') {
        await prisma.repoNotificationPreference.deleteMany({
          where: {
            userId,
            repoId,
          },
        });
        return {
          preference: {
            id: null,
            userId,
            repoId,
            mode: 'DEFAULT' as const,
            createdAt: null,
            updatedAt: null,
          },
        };
      }

      const preference = await prisma.repoNotificationPreference.upsert({
        where: {
          userId_repoId: {
            userId,
            repoId,
          },
        },
        create: {
          userId,
          repoId,
          mode: body.mode,
        },
        update: {
          mode: body.mode,
        },
        select: {
          id: true,
          mode: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return {
        preference: {
          id: preference.id,
          userId,
          repoId,
          mode: preference.mode,
          createdAt: preference.createdAt,
          updatedAt: preference.updatedAt,
        },
      };
    },
  );

  server.get('/workspaces/:workspaceId/repos/:repoId/stars', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }
    const repoEntityId = accessResult.access.repo.id;

    const [count, viewerHasStar] = await Promise.all([
      prisma.repoStar.count({
        where: { repoId: repoEntityId },
      }),
      accessResult.userId
        ? prisma.repoStar
            .findUnique({
              where: {
                userId_repoId: {
                  userId: accessResult.userId,
                  repoId: repoEntityId,
                },
              },
              select: { id: true },
            })
            .then((star) => Boolean(star))
        : Promise.resolve(false),
    ]);

    return {
      stars: {
        count,
        viewerHasStar,
      },
    };
  });

  server.put('/workspaces/:workspaceId/repos/:repoId/star', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const userId = accessResult.userId ?? request.user.sub;
    const repoEntityId = accessResult.access.repo.id;
    await prisma.repoStar.upsert({
      where: {
        userId_repoId: {
          userId,
          repoId: repoEntityId,
        },
      },
      create: {
        userId,
        repoId: repoEntityId,
      },
      update: {},
    });

    const count = await prisma.repoStar.count({
      where: { repoId: repoEntityId },
    });

    return {
      star: {
        repoId,
        userId,
        viewerHasStar: true,
        count,
      },
    };
  });

  server.delete('/workspaces/:workspaceId/repos/:repoId/star', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const userId = accessResult.userId ?? request.user.sub;
    const repoEntityId = accessResult.access.repo.id;
    await prisma.repoStar.deleteMany({
      where: {
        userId,
        repoId: repoEntityId,
      },
    });

    const count = await prisma.repoStar.count({
      where: { repoId: repoEntityId },
    });

    return {
      star: {
        repoId,
        userId,
        viewerHasStar: false,
        count,
      },
    };
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/pin', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const userId = accessResult.userId ?? request.user.sub;
    const repoEntityId = accessResult.access.repo.id;
    const pin = await prisma.repoPin.findUnique({
      where: {
        userId_repoId: {
          userId,
          repoId: repoEntityId,
        },
      },
      select: {
        id: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      pin: {
        repoId,
        userId,
        viewerHasPin: Boolean(pin),
        sortOrder: pin?.sortOrder ?? null,
        createdAt: pin?.createdAt ?? null,
        updatedAt: pin?.updatedAt ?? null,
      },
    };
  });

  server.put('/workspaces/:workspaceId/repos/:repoId/pin', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const userId = accessResult.userId ?? request.user.sub;
    const repoEntityId = accessResult.access.repo.id;
    const existing = await prisma.repoPin.findUnique({
      where: {
        userId_repoId: {
          userId,
          repoId: repoEntityId,
        },
      },
      select: {
        id: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (existing) {
      return {
        pin: {
          repoId,
          userId,
          viewerHasPin: true,
          sortOrder: existing.sortOrder,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      };
    }

    const lastPin = await prisma.repoPin.findFirst({
      where: { userId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const created = await prisma.repoPin.create({
      data: {
        userId,
        repoId: repoEntityId,
        sortOrder: (lastPin?.sortOrder ?? -1) + 1,
      },
      select: {
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      pin: {
        repoId,
        userId,
        viewerHasPin: true,
        sortOrder: created.sortOrder,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    };
  });

  server.delete('/workspaces/:workspaceId/repos/:repoId/pin', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const userId = accessResult.userId ?? request.user.sub;
    const repoEntityId = accessResult.access.repo.id;
    await prisma.repoPin.deleteMany({
      where: {
        userId,
        repoId: repoEntityId,
      },
    });

    return {
      pin: {
        repoId,
        userId,
        viewerHasPin: false,
      },
    };
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/fork', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = forkRepoSchema.parse(request.body ?? {});

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const sourceRepo = accessResult.access.repo;
    const viewerId = accessResult.userId ?? request.user.sub;

    const personalWorkspace = await prisma.workspace.findFirst({
      where: {
        ownerUserId: viewerId,
        isPersonal: true,
      },
      select: {
        id: true,
      },
    });
    const targetWorkspaceId = body.targetWorkspaceId ?? personalWorkspace?.id;
    if (!targetWorkspaceId) {
      return reply
        .code(400)
        .send({ message: 'No target workspace found for fork.' });
    }

    const membership = await requireWorkspaceMember(targetWorkspaceId, viewerId);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }
    const targetActorRole = membership.member?.role ?? 'MEMBER';

    const targetWorkspace = await prisma.workspace.findUnique({
      where: { id: targetWorkspaceId },
      select: {
        id: true,
        slug: true,
        isPersonal: true,
        publicReadRequiresAuth: true,
        repoCreationPolicy: true,
      },
    });
    if (!targetWorkspace) {
      return reply.code(404).send({ message: 'Target workspace not found.' });
    }

    const forkName = normalizeDisplayName(body.name?.trim() || sourceRepo.name);
    const forkNameError = validateRepoName(forkName);
    if (forkNameError) {
      return reply.code(400).send({ message: forkNameError });
    }
    const defaultSlug =
      body.slug ??
      (targetWorkspaceId === sourceRepo.workspaceId
        ? `${sourceRepo.slug}-fork`
        : sourceRepo.slug);
    const forkSlug = toSlug(defaultSlug || forkName) || `${sourceRepo.slug}-fork`;
    const forkSlugError = validateRouteSlug(forkSlug);
    if (forkSlugError) {
      return reply
        .code(400)
        .send({ message: `Invalid repository slug. ${forkSlugError}` });
    }
    const forkVisibility =
      body.visibility ?? (sourceRepo.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE');

    if (targetWorkspace.isPersonal && forkVisibility === 'INTERNAL') {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces cannot create internal repos.' });
    }
    if (
      !targetWorkspace.isPersonal &&
      !canRoleCreateRepos(targetActorRole, targetWorkspace.repoCreationPolicy)
    ) {
      return reply.code(403).send({ message: 'Insufficient permissions.' });
    }

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const sourceRepoDir = await getRepoDir(
      repoRoot,
      sourceRepo.workspace.slug,
      sourceRepo.slug,
    );

    try {
      const forkRepo = await prisma.repo.create({
        data: {
          workspaceId: targetWorkspaceId,
          name: forkName,
          slug: forkSlug,
          visibility: forkVisibility,
          publicReadRequiresAuth:
            forkVisibility === 'PUBLIC'
              ? sourceRepo.publicReadRequiresAuth
              : targetWorkspace.publicReadRequiresAuth,
          forkedFromRepoId: sourceRepo.id,
          members: {
            create: {
              userId: viewerId,
              role: 'ADMIN',
            },
          },
        },
        select: {
          id: true,
          workspaceId: true,
          name: true,
          slug: true,
          visibility: true,
          publicReadRequiresAuth: true,
          defaultBranch: true,
          forkedFromRepoId: true,
        },
      });

      try {
        await cloneBareRepo(sourceRepoDir, repoRoot, targetWorkspace.slug, forkRepo.slug);
      } catch (error) {
        await prisma.repo.delete({ where: { id: forkRepo.id } });
        throw error;
      }

      return reply.code(201).send({
        repo: {
          ...forkRepo,
          workspaceId: forkRepo.workspaceId,
          workspaceSlug: targetWorkspace.slug,
        },
        forkedFrom: {
          id: sourceRepo.id,
          workspaceId: sourceRepo.workspaceId,
          name: sourceRepo.name,
          slug: sourceRepo.slug,
          workspaceSlug: sourceRepo.workspace.slug,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ message: 'Repo slug already exists.' });
        }
      }
      throw error;
    }
  });

  server.delete('/workspaces/:workspaceId/repos/:repoId', async (request, reply) => {
    await request.jwtVerify();
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const workspaceMembership = await requireWorkspaceMember(
      workspaceId,
      request.user.sub,
      ['OWNER'],
    );
    if (workspaceMembership.error) {
      return reply.code(403).send({ message: workspaceMembership.error });
    }

    const canonicalWorkspaceId = workspaceMembership.workspaceId;
    if (!canonicalWorkspaceId) {
      return reply.code(403).send({ message: 'Not a member of this workspace.' });
    }
    const repo = await prisma.repo.findFirst({
      where: {
        workspaceId: canonicalWorkspaceId,
        OR: [{ id: repoId }, { slug: repoId }],
      },
      select: {
        id: true,
        slug: true,
        workspace: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!repo) {
      return reply.code(404).send({ message: 'Repo not found.' });
    }

    await prisma.$transaction(async (tx) => {
      await deleteRepoData(tx, repo.id);
    });

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const repoDir = path.join(repoRoot, repo.workspace.slug, `${repo.slug}.git`);
    await rm(repoDir, { recursive: true, force: true });

    return { ok: true };
  });

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/collaborators',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }
      const canonicalRepoId = accessResult.access.repo.id;

      const collaborators = await prisma.repoMember.findMany({
        where: { repoId: canonicalRepoId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: { id: true, email: true, username: true, name: true },
          },
        },
      });

      return { collaborators };
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/collaborators',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = collaboratorSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repoAccess = accessResult.access.repo;
      const repoWorkspace = repoAccess.workspace;
      const canonicalRepoId = repoAccess.id;
      const canonicalWorkspaceId = repoWorkspace.id;
      let target: ReturnType<typeof parseWorkspaceInviteTarget>;
      try {
        target = parseWorkspaceInviteTarget(body.identifier);
      } catch (error) {
        return reply.code(400).send({
          message:
            error instanceof Error ? error.message : 'Invalid collaborator target.',
        });
      }
      const user =
        target.type === 'email'
          ? await prisma.user.findFirst({
              where: {
                email: { equals: target.value, mode: 'insensitive' },
              },
              select: { id: true, email: true, username: true, name: true },
            })
          : await prisma.user.findFirst({
              where: {
                username: { equals: target.value, mode: 'insensitive' },
              },
              select: { id: true, email: true, username: true, name: true },
            });

      if (!user) {
        return reply.code(404).send({
          message:
            'User not found. Ask them to create an account first, then add by username or email.',
        });
      }

      const existingCollaborator = await prisma.repoMember.findUnique({
        where: {
          repoId_userId: {
            repoId: canonicalRepoId,
            userId: user.id,
          },
        },
        select: { id: true, role: true },
      });

      if (!repoWorkspace.isPersonal) {
        const isWorkspaceMember = await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: canonicalWorkspaceId,
              userId: user.id,
            },
          },
          select: { id: true },
        });

        if (!isWorkspaceMember && repoAccess.visibility === 'INTERNAL') {
          return reply
            .code(403)
            .send({ message: 'Internal repositories allow workspace members only.' });
        }

        if (!isWorkspaceMember && !repoWorkspace.allowOutsideCollaborators) {
          return reply
            .code(403)
            .send({ message: 'Outside collaborators are disabled.' });
        }
      }

      const collaborator = await prisma.repoMember.upsert({
        where: {
          repoId_userId: {
            repoId: canonicalRepoId,
            userId: user.id,
          },
        },
        update: {
          role: body.role ?? 'WRITE',
        },
        create: {
          repoId: canonicalRepoId,
          userId: user.id,
          role: body.role ?? 'WRITE',
        },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: {
            select: { id: true, email: true, username: true, name: true },
          },
        },
      });

      if (user.id !== accessResult.userId) {
        const actor = await prisma.user.findUnique({
          where: { id: accessResult.userId ?? request.user.sub },
          select: { name: true, username: true, email: true },
        });
        const actorLabel =
          actor?.name || actor?.username || actor?.email || 'A repository admin';
        const actionLabel = existingCollaborator
          ? `updated your role to ${collaborator.role}`
          : `added you with ${collaborator.role} access`;
        try {
          await prisma.notification.create({
            data: {
              recipientId: user.id,
              actorId: accessResult.userId ?? request.user.sub,
              type: 'SYSTEM',
              title: `Repository access: ${repoAccess.name}`,
              body: `${actorLabel} ${actionLabel}.`,
              workspaceId: canonicalWorkspaceId,
              repoId: canonicalRepoId,
            },
          });
        } catch (notificationError) {
          request.log.warn(
            { error: notificationError, repoId, recipientId: user.id },
            'Unable to create repository collaborator notification.',
          );
        }
      }

      return reply.send({ collaborator });
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/collaborators/:userId',
    async (request, reply) => {
      const { workspaceId, repoId, userId } = request.params as {
        workspaceId: string;
        repoId: string;
        userId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }
      const canonicalRepoId = accessResult.access.repo.id;

      const existing = await prisma.repoMember.findUnique({
        where: {
          repoId_userId: {
            repoId: canonicalRepoId,
            userId,
          },
        },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({ message: 'Collaborator not found.' });
      }

      await prisma.repoMember.delete({
        where: { id: existing.id },
      });

      return reply.send({ ok: true });
    },
  );

  server.get('/workspaces/:workspaceId/repos/:repoId/teams', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'ADMIN',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const teams = await prisma.teamRepoPermission.findMany({
      where: { repoId, team: { workspaceId } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        team: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    return { teams };
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/branches', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;

    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    try {
      const repoDir = await ensureRepoStorageDir(
        repoRoot,
        repo.workspace.slug,
        repo.slug,
      );
      const branches = (await listBranches(repoDir)).map((branch) => ({
        ...branch,
        name: sanitizeBranchRef(branch.name),
      }));
      return { branches };
    } catch (error) {
      request.log.warn(
        { err: error, workspaceId, repoId, repoRoot },
        'Unable to list branches; returning fallback default branch',
      );
      return {
        branches: repo.defaultBranch
          ? [{ name: sanitizeBranchRef(repo.defaultBranch), sha: '' }]
          : [],
      };
    }
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/branches', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = createBranchSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const fromBranch = sanitizeBranchRef(body.fromBranch ?? repo.defaultBranch);

    try {
      const repoDir = await ensureRepoStorageDir(
        repoRoot,
        repo.workspace.slug,
        repo.slug,
      );
      const branch = await createBranch(repoDir, body.name, fromBranch);
      const cleanBranch = {
        ...branch,
        name: sanitizeBranchRef(branch.name),
      };
      return reply.code(201).send({ branch: cleanBranch });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create branch.';

      if (message === 'Branch already exists.') {
        return reply.code(409).send({ message });
      }
      if (message === 'Source branch does not exist yet.') {
        return reply.code(400).send({ message });
      }
      if (message.toLowerCase().includes('invalid')) {
        return reply.code(400).send({ message: 'Invalid branch name.' });
      }

      return reply.code(500).send({ message: 'Unable to create branch.' });
    }
  });

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/branch-rules',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const rules = await prisma.branchRule.findMany({
        where: { repoId: repo.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          pattern: true,
          requirePr: true,
          requireCodeOwners: true,
          requireApprovals: true,
          blockDirectPush: true,
          requiredChecks: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { rules };
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/branch-rules',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = createBranchRuleSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const pattern = body.pattern.trim();
      const requiredChecks = normalizeRequiredChecks(body.requiredChecks);
      if (!pattern) {
        return reply.code(400).send({ message: 'Rule pattern is required.' });
      }

      try {
        const rule = await prisma.branchRule.create({
          data: {
            repoId: repo.id,
            pattern,
            requirePr: body.requirePr ?? true,
            requireCodeOwners: body.requireCodeOwners ?? false,
            requireApprovals:
              body.requirePr === false ? 0 : body.requireApprovals ?? 1,
            blockDirectPush: body.blockDirectPush ?? true,
            requiredChecks,
          },
          select: {
            id: true,
            pattern: true,
            requirePr: true,
            requireCodeOwners: true,
            requireApprovals: true,
            blockDirectPush: true,
            requiredChecks: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.code(201).send({ rule });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return reply
            .code(409)
            .send({
              message: 'A rule for this branch pattern already exists.',
            });
        }
        return reply
          .code(500)
          .send({ message: 'Unable to create branch rule.' });
      }
    },
  );

  server.patch(
    '/workspaces/:workspaceId/repos/:repoId/branch-rules/:ruleId',
    async (request, reply) => {
      const { workspaceId, repoId, ruleId } = request.params as {
        workspaceId: string;
        repoId: string;
        ruleId: string;
      };
      const body = updateBranchRuleSchema.parse(request.body);

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const existing = await prisma.branchRule.findFirst({
        where: { id: ruleId, repoId: repo.id },
        select: {
          id: true,
          requiredChecks: true,
          requirePr: true,
          requireCodeOwners: true,
          requireApprovals: true,
        },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Branch rule not found.' });
      }

      const nextRequirePr = body.requirePr ?? existing.requirePr;
      const nextRequireCodeOwners =
        body.requireCodeOwners ?? existing.requireCodeOwners ?? false;
      const nextRequireApprovals =
        nextRequirePr === false
          ? 0
          : body.requireApprovals ?? existing.requireApprovals;
      const nextRequiredChecks =
        body.requiredChecks !== undefined
          ? normalizeRequiredChecks(body.requiredChecks)
          : existing.requiredChecks;

      const pattern = body.pattern?.trim();
      if (body.pattern !== undefined && !pattern) {
        return reply.code(400).send({ message: 'Rule pattern is required.' });
      }
      if (nextRequireCodeOwners && !nextRequirePr) {
        return reply
          .code(400)
          .send({ message: 'requireCodeOwners requires requirePr to be enabled.' });
      }

      try {
        const rule = await prisma.branchRule.update({
          where: { id: ruleId },
          data: {
            pattern: pattern ?? undefined,
            requirePr: nextRequirePr,
            requireCodeOwners: nextRequireCodeOwners,
            requireApprovals: nextRequireApprovals,
            blockDirectPush: body.blockDirectPush ?? undefined,
            requiredChecks: nextRequiredChecks,
          },
          select: {
            id: true,
            pattern: true,
            requirePr: true,
            requireCodeOwners: true,
            requireApprovals: true,
            blockDirectPush: true,
            requiredChecks: true,
            createdAt: true,
            updatedAt: true,
          },
        });

        return reply.send({ rule });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return reply
            .code(409)
            .send({
              message: 'A rule for this branch pattern already exists.',
            });
        }
        return reply
          .code(500)
          .send({ message: 'Unable to update branch rule.' });
      }
    },
  );

  server.delete(
    '/workspaces/:workspaceId/repos/:repoId/branch-rules/:ruleId',
    async (request, reply) => {
      const { workspaceId, repoId, ruleId } = request.params as {
        workspaceId: string;
        repoId: string;
        ruleId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'ADMIN',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const existing = await prisma.branchRule.findFirst({
        where: { id: ruleId, repoId: repo.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ message: 'Branch rule not found.' });
      }

      await prisma.branchRule.delete({
        where: { id: ruleId },
      });
      return reply.send({ ok: true });
    },
  );

  server.get('/workspaces/:workspaceId/repos/:repoId/tree', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = treeQuerySchema.parse(request.query);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const branch = sanitizeBranchRef(query.branch ?? repo.defaultBranch);
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

    try {
      await ensureRepoStorageDir(repoRoot, repo.workspace.slug, repo.slug);
      return await getRepoTreeRpc({
        repoId: repo.id,
        branch,
        path: query.path ?? '',
      }, { requestId: request.id });
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid path.')) {
        return reply.code(400).send({ message: 'Invalid path.' });
      }
      request.log.warn(
        { err: error, workspaceId, repoId, branch, path: query.path ?? '' },
        'Unable to read repository tree; returning fallback empty entries',
      );
      if (!query.path) {
        return {
          branch,
          path: '',
          entries: [],
        };
      }
      return reply.code(500).send({ message: 'Unable to read repository tree.' });
    }
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/blob', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = blobQuerySchema.parse(request.query);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const branch = sanitizeBranchRef(query.branch ?? repo.defaultBranch);
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

    try {
      await ensureRepoStorageDir(repoRoot, repo.workspace.slug, repo.slug);
      return await getRepoBlobRpc({
        repoId: repo.id,
        branch,
        path: query.path,
      }, { requestId: request.id });
    } catch (error) {
      if (error instanceof Error && error.message.includes('File not found.')) {
        return reply.code(404).send({ message: 'File not found.' });
      }
      return reply.code(500).send({ message: 'Unable to read file.' });
    }
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/commits', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = commitQuerySchema.parse(request.query);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const branch = sanitizeBranchRef(query.branch ?? repo.defaultBranch);
    const limit = query.limit ?? 20;
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    try {
      await ensureRepoStorageDir(repoRoot, repo.workspace.slug, repo.slug);
      return await getRepoCommitsRpc({
        repoId: repo.id,
        branch,
        limit,
      }, { requestId: request.id });
    } catch (error) {
      request.log.warn(
        { err: error, workspaceId, repoId, branch, limit },
        'Unable to read commit history; returning empty list',
      );
      return {
        commits: [],
        branch,
        limit,
      };
    }
  });

  server.post('/workspaces/:workspaceId/repos/:repoId/commits', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const body = createCommitSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const branch = sanitizeBranchRef(body.branch ?? repo.defaultBranch);
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';

    const user = await prisma.user.findUnique({
      where: { id: accessResult.userId ?? request.user.sub },
      select: { name: true, email: true },
    });

    const authorName =
      body.authorName ??
      user?.name?.trim() ??
      user?.email?.split('@')[0] ??
      'Uynis user';
    const authorEmail =
      body.authorEmail ??
      user?.email ??
      `${accessResult.userId ?? request.user.sub}@uynis.local`;

    try {
      const rules = await prisma.branchRule.findMany({
        where: { repoId: repo.id },
        select: {
          id: true,
          pattern: true,
          requirePr: true,
          requireCodeOwners: true,
          requireApprovals: true,
          blockDirectPush: true,
          updatedAt: true,
        },
      });
      const matchedRule = selectBranchRule(rules, branch);
      if (
        matchedRule &&
        (matchedRule.blockDirectPush ||
          matchedRule.requirePr ||
          matchedRule.requireCodeOwners)
      ) {
        return reply.code(409).send({
          message: `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
        });
      }

      const repoDir = await ensureRepoStorageDir(
        repoRoot,
        repo.workspace.slug,
        repo.slug,
      );
      const commit = await createCommitWithChanges({
        repoDir,
        branch,
        baseBranch: repo.defaultBranch,
        message: body.message,
        authorName,
        authorEmail,
        changes: body.changes,
      });
      await enqueueRepoWebhookEvent({
        repoId: repo.id,
        eventType: 'PUSH',
        payload: {
          requestId: request.id,
          actorId: accessResult.userId ?? request.user?.sub ?? null,
          workspaceId,
          workspaceSlug: repo.workspace.slug,
          repoId: repo.id,
          repoSlug: repo.slug,
          branch,
          commitSha: commit.sha,
          message: body.message,
          changedPaths: commit.changedPaths,
          source: 'api-commit',
        },
      });
      void reindexRepoCodeById({
        repoId: repo.id,
        branch,
        requestId: request.id,
      }).catch((reindexError) => {
        request.log.warn(
          {
            err: reindexError,
            repoId: repo.id,
            branch,
          },
          'Unable to reindex repository code after API commit',
        );
      });
      return reply.code(201).send({ commit });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to create commit.';
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr?: unknown }).stderr ?? '')
          : '';
      const combined = `${message}\n${stderr}`.toLowerCase();

      if (
        message === 'No changes to commit.' ||
        message === 'Invalid path.' ||
        message.toLowerCase().includes('invalid')
      ) {
        return reply.code(400).send({ message });
      }

      if (combined.includes('direct pushes are blocked for')) {
        return reply.code(409).send({
          message: `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
        });
      }

      if (combined.includes('missing required checks')) {
        return reply.code(409).send({
          message: 'Missing required checks for this branch. Complete required checks and try again.',
        });
      }

      if (combined.includes('unable to resolve repository for branch rules')) {
        request.log.error(
          {
            err: error,
            repoId,
            branch,
            repoRoot,
          },
          'Commit rejected because branch-rule hook could not resolve repository path',
        );
        return reply.code(500).send({
          message:
            'Commit validation failed while resolving repository rules. Retry in a moment or contact an administrator.',
        });
      }

      if (combined.includes('repository not found')) {
        return reply.code(404).send({ message: 'Repository not found.' });
      }

      request.log.error(
        {
          err: error,
          repoId,
          branch,
          repoRoot,
        },
        'Unable to create commit',
      );

      return reply.code(500).send({ message: 'Unable to create commit.' });
    }
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/commits/:sha/checks', async (request, reply) => {
    const { workspaceId, repoId, sha } = request.params as {
      workspaceId: string;
      repoId: string;
      sha: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const commitSha = commitShaSchema.parse(sha).toLowerCase();
    const checks = await prisma.commitCheck.findMany({
      where: {
        repoId: repo.id,
        commitSha,
      },
      orderBy: [{ context: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        context: true,
        status: true,
        details: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send({ commitSha, checks });
  });

  server.put('/workspaces/:workspaceId/repos/:repoId/commits/:sha/checks', async (request, reply) => {
    const { workspaceId, repoId, sha } = request.params as {
      workspaceId: string;
      repoId: string;
      sha: string;
    };
    const body = commitCheckSchema.parse(request.body);

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const commitSha = commitShaSchema.parse(sha).toLowerCase();
    const context = body.context.trim();
    if (!context) {
      return reply.code(400).send({ message: 'Check context is required.' });
    }

    const check = await prisma.commitCheck.upsert({
      where: {
        repoId_commitSha_context: {
          repoId: repo.id,
          commitSha,
          context,
        },
      },
      create: {
        repoId: repo.id,
        commitSha,
        context,
        status: body.status,
        details: body.details?.trim() || null,
      },
      update: {
        status: body.status,
        details: body.details?.trim() || null,
      },
      select: {
        id: true,
        context: true,
        status: true,
        details: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return reply.send({ commitSha, check });
  });

  server.get('/workspaces/:workspaceId/repos/:repoId/import/jobs', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'READ',
    });
    if (!accessResult) {
      return;
    }

    const jobs = await prisma.repoImportJob.findMany({
      where: { repoId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return { jobs };
  });

  server.get(
    '/workspaces/:workspaceId/repos/:repoId/import/jobs/:jobId',
    async (request, reply) => {
      const { workspaceId, repoId, jobId } = request.params as {
        workspaceId: string;
        repoId: string;
        jobId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'READ',
      });
      if (!accessResult) {
        return;
      }

      const job = await prisma.repoImportJob.findFirst({
        where: { id: jobId, repoId },
      });
      if (!job) {
        return reply.code(404).send({ message: 'Import job not found.' });
      }

      return { job };
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/import/jobs/:jobId/cancel',
    async (request, reply) => {
      const { workspaceId, repoId, jobId } = request.params as {
        workspaceId: string;
        repoId: string;
        jobId: string;
      };

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const job = await prisma.repoImportJob.findFirst({
        where: { id: jobId, repoId },
      });
      if (!job) {
        return reply.code(404).send({ message: 'Import job not found.' });
      }

      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        return reply.code(409).send({ message: 'Import job already finished.' });
      }

      const updated = await prisma.repoImportJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          error: 'Import cancelled by user.',
          nextRunAt: null,
        },
      });

      return reply.send({ job: updated });
    },
  );

  server.post('/workspaces/:workspaceId/repos/:repoId/import/jobs/zip', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };

    const query = importRepoQuerySchema.parse(request.query ?? {});

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const repo = accessResult.access.repo;
    const branch = query.branch ?? repo.defaultBranch;
    const rules = await prisma.branchRule.findMany({
      where: { repoId },
      select: {
        id: true,
        pattern: true,
        requirePr: true,
        requireCodeOwners: true,
        requireApprovals: true,
        blockDirectPush: true,
        updatedAt: true,
      },
    });
    const matchedRule = selectBranchRule(rules, branch);
    if (
      matchedRule &&
      (matchedRule.blockDirectPush ||
        matchedRule.requirePr ||
        matchedRule.requireCodeOwners)
    ) {
      return reply.code(409).send({
        message: `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
      });
    }

    const archive = await request.file();
    if (!archive) {
      return reply.code(400).send({ message: 'Repository archive is required.' });
    }
    if (archive.fieldname && archive.fieldname !== 'archive') {
      return reply.code(400).send({ message: 'Invalid archive field.' });
    }

    const filename = (archive.filename ?? '').toLowerCase();
    if (
      !filename.endsWith('.zip') &&
      archive.mimetype !== 'application/zip' &&
      archive.mimetype !== 'application/x-zip-compressed'
    ) {
      return reply.code(400).send({ message: 'Upload a .zip archive.' });
    }

    const buffer = await archive.toBuffer();
    if (!buffer.length) {
      return reply.code(400).send({ message: 'Archive is empty.' });
    }

    const job = await prisma.repoImportJob.create({
      data: {
        repoId,
        createdById: accessResult.userId ?? request.user.sub,
        type: 'ZIP',
        status: 'QUEUED',
        branch,
        message: query.message ?? 'Import repository archive',
        maxAttempts: query.maxAttempts ?? 3,
      },
    });

    try {
      const archivePath = await saveImportArchive(job.id, buffer);
      await prisma.repoImportJob.update({
        where: { id: job.id },
        data: { archivePath },
      });
    } catch (error) {
      await prisma.repoImportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          error:
            error instanceof Error ? error.message : 'Unable to store archive.',
        },
      });
      return reply.code(500).send({ message: 'Unable to store archive.' });
    }

    scheduleImportJob(job.id);
    const createdJob = await prisma.repoImportJob.findUnique({
      where: { id: job.id },
    });
    return reply.code(202).send({ job: createdJob });
  });

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/import/uploads',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const body = importUploadSchema.parse(request.body ?? {});

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const maxUploadBytes = Number.parseInt(
        process.env.IMPORT_UPLOAD_MAX_BYTES ?? '262144000',
        10,
      );

      const maxBytes = body.size ? Math.min(body.size, maxUploadBytes) : maxUploadBytes;
      if (body.size && body.size > maxUploadBytes) {
        return reply.code(413).send({ message: 'File exceeds allowed size.' });
      }

      const { token, record } = await createUploadToken({
        purpose: 'REPO_IMPORT_ARCHIVE',
        repoId,
        createdById: accessResult.userId ?? request.user.sub,
        maxBytes,
        contentType: body.contentType,
        fileName: body.fileName,
        expiresInMinutes: 30,
        storagePath: 'pending',
      });
      const storagePath = resolveUploadStoragePath(record.id, body.fileName);
      await prisma.uploadToken.update({
        where: { id: record.id },
        data: { storagePath },
      });

      const baseUrl =
        process.env.API_PUBLIC_URL ??
        `${request.protocol}://${request.hostname}`;
      const uploadUrl = `${baseUrl}/uploads/signed/${record.id}?token=${token}`;

      return reply.send({
        uploadId: record.id,
        uploadUrl,
        expiresAt: record.expiresAt,
        maxBytes: record.maxBytes,
      });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/import/jobs/zip/from-upload',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };

      const body = importFromUploadSchema.parse(request.body ?? {});

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const upload = await prisma.uploadToken.findUnique({
        where: { id: body.uploadId },
      });
      if (!upload || upload.repoId !== repoId) {
        return reply.code(404).send({ message: 'Upload not found.' });
      }
      if (upload.purpose !== 'REPO_IMPORT_ARCHIVE') {
        return reply.code(400).send({ message: 'Upload is not a repo archive.' });
      }
      if (!upload.consumedAt) {
        return reply.code(409).send({ message: 'Upload is not completed yet.' });
      }
      if (upload.expiresAt.getTime() < Date.now()) {
        return reply.code(410).send({ message: 'Upload expired.' });
      }

      const repo = accessResult.access.repo;
      const branch = body.branch ?? repo.defaultBranch;
      const rules = await prisma.branchRule.findMany({
        where: { repoId },
        select: {
          id: true,
          pattern: true,
          requirePr: true,
          requireCodeOwners: true,
          requireApprovals: true,
          blockDirectPush: true,
          updatedAt: true,
        },
      });
      const matchedRule = selectBranchRule(rules, branch);
      if (
        matchedRule &&
        (matchedRule.blockDirectPush ||
          matchedRule.requirePr ||
          matchedRule.requireCodeOwners)
      ) {
        return reply.code(409).send({
          message: `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
        });
      }

      const job = await prisma.repoImportJob.create({
        data: {
          repoId,
          createdById: accessResult.userId ?? request.user.sub,
          type: 'ZIP',
          status: 'QUEUED',
          branch,
          message: body.message ?? 'Import repository archive',
          maxAttempts: body.maxAttempts ?? 3,
          archivePath: upload.storagePath,
        },
      });

      scheduleImportJob(job.id);
      const createdJob = await prisma.repoImportJob.findUnique({
        where: { id: job.id },
      });
      return reply.code(202).send({ job: createdJob });
    },
  );

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/import/jobs/remote',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = importRemoteSchema.parse(request.body ?? {});

      if (!isAllowedRemoteUrl(body.url)) {
        return reply
          .code(400)
          .send({ message: 'Remote URL must be a public http(s) URL.' });
      }

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
      const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
      const existingBranches = await listBranches(repoDir);
      if (existingBranches.length) {
        return reply.code(409).send({
          message: 'Repository already has content. Create a new repo to import.',
        });
      }

      const job = await prisma.repoImportJob.create({
        data: {
          repoId,
          createdById: accessResult.userId ?? request.user.sub,
          type: 'REMOTE',
          status: 'QUEUED',
          importUrl: body.url,
          branch: body.branch?.trim() || undefined,
          maxAttempts: body.maxAttempts ?? 3,
        },
      });

      scheduleImportJob(job.id);
      const createdJob = await prisma.repoImportJob.findUnique({
        where: { id: job.id },
      });
      return reply.code(202).send({ job: createdJob });
    },
  );

  server.post('/workspaces/:workspaceId/repos/:repoId/import', async (request, reply) => {
    const { workspaceId, repoId } = request.params as {
      workspaceId: string;
      repoId: string;
    };
    const query = importRepoQuerySchema.parse(request.query ?? {});

    const accessResult = await requireRepoAccess(request, reply, {
      workspaceId,
      repoId,
      requiredRole: 'WRITE',
      requireAuth: true,
    });
    if (!accessResult) {
      return;
    }

    const archive = await request.file();
    if (!archive) {
      return reply.code(400).send({ message: 'Repository archive is required.' });
    }
    if (archive.fieldname && archive.fieldname !== 'archive') {
      return reply.code(400).send({ message: 'Invalid archive field.' });
    }

    const filename = (archive.filename ?? '').toLowerCase();
    const isZip =
      archive.mimetype === 'application/zip' ||
      archive.mimetype === 'application/x-zip-compressed' ||
      filename.endsWith('.zip');
    if (!isZip) {
      return reply.code(400).send({ message: 'Upload a .zip archive.' });
    }

    const buffer = await archive.toBuffer();
    if (!buffer.length) {
      return reply.code(400).send({ message: 'Archive is empty.' });
    }

    const repo = accessResult.access.repo;
    const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
    const branch = query.branch ?? repo.defaultBranch;
    const message = query.message ?? 'Import repository archive';

    const rules = await prisma.branchRule.findMany({
      where: { repoId },
      select: {
        id: true,
        pattern: true,
        requirePr: true,
        requireCodeOwners: true,
        requireApprovals: true,
        blockDirectPush: true,
        updatedAt: true,
      },
    });
    const matchedRule = selectBranchRule(rules, branch);
    if (
      matchedRule &&
      (matchedRule.blockDirectPush ||
        matchedRule.requirePr ||
        matchedRule.requireCodeOwners)
    ) {
      return reply.code(409).send({
        message: `Direct commits to "${branch}" are blocked by branch protection. Open a pull request instead.`,
      });
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      return reply.code(400).send({ message: 'Archive could not be read.' });
    }

    const entries = zip.getEntries();
    const fileEntries = entries.filter(
      (entry) =>
        !entry.isDirectory &&
        !entry.entryName.startsWith('.git/') &&
        !entry.entryName.startsWith('__MACOSX/'),
    );
    const topLevelFolders = new Set(
      fileEntries
        .map((entry) => entry.entryName.split('/')[0])
        .filter(Boolean),
    );
    const stripPrefix = topLevelFolders.size === 1 ? [...topLevelFolders][0] : null;

    const changes = fileEntries.flatMap((entry) => {
      if (entry.isDirectory) {
        return [];
      }
      const entryName =
        stripPrefix && entry.entryName.startsWith(`${stripPrefix}/`)
          ? entry.entryName.slice(stripPrefix.length + 1)
          : entry.entryName;
      let cleanPath = '';
      try {
        cleanPath = normalizeRepoPath(entryName);
      } catch {
        return [];
      }
      if (!cleanPath) {
        return [];
      }
      const data = entry.getData();
      if (!data?.length) {
        return [];
      }
      return [
        {
          path: cleanPath,
          contentBase64: data.toString('base64'),
        },
      ];
    });

    if (!changes.length) {
      return reply.code(400).send({ message: 'Archive contained no files.' });
    }
    if (changes.length > 5000) {
      return reply
        .code(400)
        .send({ message: 'Archive contains too many files.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: accessResult.userId ?? request.user.sub },
      select: { name: true, email: true },
    });

    const authorName =
      user?.name?.trim() ?? user?.email?.split('@')[0] ?? 'Uynis user';
    const authorEmail =
      user?.email ?? `${accessResult.userId ?? request.user.sub}@uynis.local`;

    try {
      const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);
      const commit = await createCommitWithChanges({
        repoDir,
        branch,
        baseBranch: repo.defaultBranch,
        message,
        authorName,
        authorEmail,
        changes,
      });

      return reply.code(201).send({
        commit,
        importedFiles: commit.changedPaths.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to import repository.';
      if (message === 'No changes to commit.' || message === 'Invalid path.') {
        return reply.code(400).send({ message });
      }
      return reply.code(500).send({ message: 'Unable to import repository.' });
    }
  });

  server.post(
    '/workspaces/:workspaceId/repos/:repoId/import/remote',
    async (request, reply) => {
      const { workspaceId, repoId } = request.params as {
        workspaceId: string;
        repoId: string;
      };
      const body = importRemoteSchema.parse(request.body ?? {});

      if (!isAllowedRemoteUrl(body.url)) {
        return reply
          .code(400)
          .send({ message: 'Remote URL must be a public http(s) URL.' });
      }

      const accessResult = await requireRepoAccess(request, reply, {
        workspaceId,
        repoId,
        requiredRole: 'WRITE',
        requireAuth: true,
      });
      if (!accessResult) {
        return;
      }

      const repo = accessResult.access.repo;
      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
      const repoDir = await getRepoDir(repoRoot, repo.workspace.slug, repo.slug);

      const existingBranches = await listBranches(repoDir);
      if (existingBranches.length) {
        return reply.code(409).send({
          message: 'Repository already has content. Create a new repo to import.',
        });
      }

      try {
        await importRemoteRepo(repoDir, body.url);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to import repository.';
        return reply.code(500).send({ message });
      }

      const branches = await listBranches(repoDir);
      if (!branches.length) {
        return reply.code(400).send({ message: 'Remote repository is empty.' });
      }

      const desiredBranch = body.branch ? sanitizeBranchRef(body.branch) : undefined;
      const branchNames = branches.map((branch) => sanitizeBranchRef(branch.name));
      let nextDefaultBranch =
        desiredBranch && branchNames.includes(desiredBranch)
          ? desiredBranch
          : branchNames.includes('main')
            ? 'main'
            : branchNames.includes('master')
              ? 'master'
              : branchNames[0];

      try {
        await setRepoHead(repoDir, nextDefaultBranch);
      } catch {
        nextDefaultBranch = repo.defaultBranch;
      }

      if (nextDefaultBranch && nextDefaultBranch !== repo.defaultBranch) {
        await prisma.repo.update({
          where: { id: repo.id },
          data: { defaultBranch: nextDefaultBranch },
        });
      }

      return reply.code(201).send({
        importedBranches: branchNames.length,
        defaultBranch: nextDefaultBranch,
      });
    },
  );

  server.post('/workspaces/:workspaceId/repos', async (request, reply) => {
    const userId = await requireAuthenticatedUserId(request);
    const body = createRepoSchema.parse(request.body);
    const repoName = normalizeDisplayName(body.name);
    const repoNameError = validateRepoName(repoName);
    if (repoNameError) {
      return reply.code(400).send({ message: repoNameError });
    }
    const { workspaceId } = request.params as { workspaceId: string };

    const membership = await requireWorkspaceMember(workspaceId, userId);
    if (membership.error) {
      return reply.code(403).send({ message: membership.error });
    }
    const actorRole = membership.member?.role ?? 'MEMBER';

    const slug = toSlug(body.slug?.trim() || repoName);
    const slugError = validateRouteSlug(slug);
    if (slugError) {
      return reply
        .code(400)
        .send({ message: `Invalid repository slug. ${slugError}` });
    }
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        slug: true,
        isPersonal: true,
        publicReadRequiresAuth: true,
        repoCreationPolicy: true,
      },
    });

    if (!workspace) {
      return reply.code(404).send({ message: 'Workspace not found.' });
    }

    if (workspace.isPersonal && body.visibility === 'INTERNAL') {
      return reply
        .code(400)
        .send({ message: 'Personal workspaces cannot create internal repos.' });
    }
    if (!workspace.isPersonal && !canRoleCreateRepos(actorRole, workspace.repoCreationPolicy)) {
      return reply.code(403).send({ message: 'Insufficient permissions.' });
    }

    try {
      const shouldInitializeRepo = body.initialize !== false;
      const repo = await prisma.repo.create({
        data: {
          workspaceId,
          name: repoName,
          slug,
          description: normalizeRepoDescription(body.description),
          visibility: body.visibility ?? 'PRIVATE',
          publicReadRequiresAuth: workspace.publicReadRequiresAuth,
          members: {
            create: {
              userId,
              role: 'ADMIN',
            },
          },
        },
        select: {
          id: true,
          workspaceId: true,
          name: true,
          slug: true,
          description: true,
          visibility: true,
          publicReadRequiresAuth: true,
          defaultBranch: true,
        },
      });

      const repoRoot = process.env.REPO_STORAGE_PATH ?? 'data/repos';
      const repoDir = path.join(repoRoot, workspace.slug, `${repo.slug}.git`);
      const defaultBranch = sanitizeBranchRef(repo.defaultBranch);
      try {
        await initBareRepo(repoRoot, workspace.slug, repo.slug);
        await setRepoHead(repoDir, defaultBranch);

        if (shouldInitializeRepo) {
          const actor = await prisma.user.findUnique({
            where: { id: userId },
            select: { name: true, username: true, email: true },
          });
          const authorName = actor?.name || actor?.username || 'Uynis';
          const authorEmail =
            actor?.email ||
            (actor?.username ? `${actor.username}@users.uynis.local` : 'noreply@uynis.local');

          await createCommitWithChanges({
            repoDir,
            branch: defaultBranch,
            message: 'chore: initialize repository',
            authorName,
            authorEmail,
            changes: [
              {
                path: 'README.md',
                content: `# ${repo.name}\n\nRepository initialized in Uynis.\n`,
              },
            ],
          });
        }
      } catch (error) {
        await prisma.repoMember.deleteMany({
          where: { repoId: repo.id },
        });
        await prisma.repo.delete({ where: { id: repo.id } });
        throw error;
      }
      return reply.code(201).send({
        repo: {
          ...repo,
          workspaceId: repo.workspaceId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          return reply.code(409).send({ message: 'Repo slug already exists.' });
        }
      }
      throw error;
    }
  });
}
