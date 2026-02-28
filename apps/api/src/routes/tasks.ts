import type { FastifyInstance } from 'fastify';
import { prisma } from '@uynis/db';
import { z } from 'zod';

const workflowTriggerSchema = z.enum([
  'ISSUE_CREATED',
  'ISSUE_CLOSED',
  'PULL_CREATED',
  'PULL_MERGED',
]);

const workflowQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'DRAFT', 'PAUSED']).optional(),
  trigger: workflowTriggerSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

const createWorkflowSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'PAUSED']).optional(),
  trigger: workflowTriggerSchema.optional(),
  workspaceId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
});

const updateWorkflowSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    status: z.enum(['ACTIVE', 'DRAFT', 'PAUSED']).optional(),
    trigger: workflowTriggerSchema.optional(),
    workspaceId: z.string().min(1).nullable().optional(),
    repoId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined ||
      value.trigger !== undefined ||
      value.workspaceId !== undefined ||
      value.repoId !== undefined,
    { message: 'No updates provided.' },
  );

const workflowParamsSchema = z.object({
  workflowId: z.string().min(1),
});

const workflowRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

type WorkflowWithMeta = {
  id: string;
  title: string;
  description: string;
  status: 'ACTIVE' | 'DRAFT' | 'PAUSED';
  trigger: 'ISSUE_CREATED' | 'ISSUE_CLOSED' | 'PULL_CREATED' | 'PULL_MERGED';
  workspaceId: string | null;
  repoId: string | null;
  createdAt: Date;
  updatedAt: Date;
  runs?: Array<{
    createdAt: Date;
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    message: string | null;
  }>;
  _count?: {
    runs: number;
  };
};

function toWorkflowResponse(workflow: WorkflowWithMeta) {
  const latestRun = workflow.runs?.[0] ?? null;
  return {
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    status: workflow.status,
    trigger: workflow.trigger,
    workspaceId: workflow.workspaceId,
    repoId: workflow.repoId,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    runCount: workflow._count?.runs ?? 0,
    lastRunAt: latestRun?.createdAt ?? null,
    lastRunStatus: latestRun?.status ?? null,
    lastRunMessage: latestRun?.message ?? null,
  };
}

async function validateWorkflowScope(input: {
  viewerId: string;
  workspaceId?: string | null;
  repoId?: string | null;
}) {
  const workspaceId = input.workspaceId ?? null;
  const repoId = input.repoId ?? null;

  if (repoId && !workspaceId) {
    throw new Error('Select a workspace when setting repository scope.');
  }

  if (workspaceId) {
    const workspaceMembership = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: input.viewerId,
      },
      select: { id: true },
    });
    if (!workspaceMembership) {
      throw new Error('You do not have access to that workspace.');
    }
  }

  if (repoId) {
    const repoAccess = await prisma.repo.findFirst({
      where: {
        id: repoId,
        workspaceId: workspaceId ?? undefined,
        OR: [
          {
            members: {
              some: {
                userId: input.viewerId,
              },
            },
          },
          {
            workspace: {
              members: {
                some: {
                  userId: input.viewerId,
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (!repoAccess) {
      throw new Error('You do not have access to that repository.');
    }
  }
}

export async function tasksRoutes(server: FastifyInstance) {
  server.get('/tasks/workflows', async (request) => {
    await request.jwtVerify();
    const viewerId = request.user.sub;
    const query = workflowQuerySchema.parse(request.query);

    const workflows = await prisma.taskWorkflow.findMany({
      where: {
        userId: viewerId,
        status: query.status,
        trigger: query.trigger,
        ...(query.q
          ? {
              OR: [
                { title: { contains: query.q, mode: 'insensitive' } },
                { description: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            status: true,
            message: true,
          },
        },
        _count: {
          select: {
            runs: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      workflows: workflows.map(toWorkflowResponse),
    };
  });

  server.get('/tasks/workflows/:workflowId/runs', async (request, reply) => {
    await request.jwtVerify();
    const viewerId = request.user.sub;
    const params = workflowParamsSchema.parse(request.params);
    const query = workflowRunsQuerySchema.parse(request.query);

    const workflow = await prisma.taskWorkflow.findFirst({
      where: {
        id: params.workflowId,
        userId: viewerId,
      },
      select: { id: true },
    });
    if (!workflow) {
      return reply.code(404).send({ message: 'Workflow not found.' });
    }

    const runs = await prisma.taskWorkflowRun.findMany({
      where: { workflowId: params.workflowId },
      orderBy: { createdAt: 'desc' },
      take: query.limit ?? 20,
      select: {
        id: true,
        trigger: true,
        status: true,
        message: true,
        issueId: true,
        pullRequestId: true,
        repoId: true,
        workspaceId: true,
        createdAt: true,
      },
    });

    return {
      runs,
    };
  });

  server.post('/tasks/workflows', async (request, reply) => {
    await request.jwtVerify();
    const viewerId = request.user.sub;
    const body = createWorkflowSchema.parse(request.body);

    try {
      await validateWorkflowScope({
        viewerId,
        workspaceId: body.workspaceId,
        repoId: body.repoId,
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Invalid workflow scope.',
      });
    }

    const workflow = await prisma.taskWorkflow.create({
      data: {
        userId: viewerId,
        title: body.title,
        description: body.description?.trim() || 'No description provided.',
        status: body.status ?? 'DRAFT',
        trigger: body.trigger ?? 'PULL_MERGED',
        workspaceId: body.workspaceId ?? null,
        repoId: body.repoId ?? null,
      },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            status: true,
            message: true,
          },
        },
        _count: {
          select: {
            runs: true,
          },
        },
      },
    });

    return reply.code(201).send({
      workflow: toWorkflowResponse(workflow),
    });
  });

  server.patch('/tasks/workflows/:workflowId', async (request, reply) => {
    await request.jwtVerify();
    const viewerId = request.user.sub;
    const params = workflowParamsSchema.parse(request.params);
    const body = updateWorkflowSchema.parse(request.body);

    const existing = await prisma.taskWorkflow.findFirst({
      where: {
        id: params.workflowId,
        userId: viewerId,
      },
      select: {
        id: true,
        workspaceId: true,
        repoId: true,
      },
    });
    if (!existing) {
      return reply.code(404).send({ message: 'Workflow not found.' });
    }

    const nextWorkspaceId =
      body.workspaceId !== undefined
        ? body.workspaceId
        : existing.workspaceId;
    const nextRepoId =
      body.repoId === undefined ? existing.repoId : body.repoId;

    try {
      await validateWorkflowScope({
        viewerId,
        workspaceId: nextWorkspaceId,
        repoId: nextRepoId,
      });
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : 'Invalid workflow scope.',
      });
    }

    const workflow = await prisma.taskWorkflow.update({
      where: { id: params.workflowId },
      data: {
        title: body.title,
        description:
          body.description !== undefined
            ? body.description.trim() || 'No description provided.'
            : undefined,
        status: body.status,
        trigger: body.trigger,
        workspaceId:
          body.workspaceId !== undefined
            ? body.workspaceId
            : undefined,
        repoId: body.repoId === undefined ? undefined : body.repoId,
      },
      include: {
        runs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
            status: true,
            message: true,
          },
        },
        _count: {
          select: {
            runs: true,
          },
        },
      },
    });

    return {
      workflow: toWorkflowResponse(workflow),
    };
  });

  server.delete('/tasks/workflows/:workflowId', async (request, reply) => {
    await request.jwtVerify();
    const viewerId = request.user.sub;
    const params = workflowParamsSchema.parse(request.params);

    const result = await prisma.taskWorkflow.deleteMany({
      where: {
        id: params.workflowId,
        userId: viewerId,
      },
    });
    if (result.count === 0) {
      return reply.code(404).send({ message: 'Workflow not found.' });
    }

    return reply.code(204).send();
  });
}

