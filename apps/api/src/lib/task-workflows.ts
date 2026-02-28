import { prisma, type TaskWorkflowTrigger } from '@uynis/db';

type TaskWorkflowEventInput = {
  trigger: TaskWorkflowTrigger;
  actorId: string;
  workspaceId?: string;
  repoId: string;
  issueId?: string;
  pullRequestId?: string;
  message?: string;
};

export async function runTaskWorkflowsForEvent(input: TaskWorkflowEventInput) {
  const workspaceId = input.workspaceId;
  if (!workspaceId) {
    return { matched: 0, recorded: 0 };
  }

  const workflows = await prisma.taskWorkflow.findMany({
    where: {
      userId: input.actorId,
      status: 'ACTIVE',
      trigger: input.trigger,
      OR: [{ workspaceId: null }, { workspaceId }],
      AND: [{ OR: [{ repoId: null }, { repoId: input.repoId }] }],
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (!workflows.length) {
    return { matched: 0, recorded: 0 };
  }

  await prisma.taskWorkflowRun.createMany({
    data: workflows.map((workflow) => ({
      workflowId: workflow.id,
      actorId: input.actorId,
      workspaceId,
      repoId: input.repoId,
      issueId: input.issueId,
      pullRequestId: input.pullRequestId,
      trigger: input.trigger,
      status: 'SUCCESS' as const,
      message: input.message
        ? `${workflow.title}: ${input.message}`
        : workflow.title,
    })),
  });

  return { matched: workflows.length, recorded: workflows.length };
}
