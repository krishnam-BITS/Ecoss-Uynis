import { prisma } from '@uynis/db';

export async function enqueuePushWebhookDeliveries(input: {
  repoId: string;
  payload: Record<string, unknown>;
}) {
  const hooks = await prisma.repoWebhook.findMany({
    where: {
      repoId: input.repoId,
      active: true,
    },
    select: {
      id: true,
      events: true,
      maxAttempts: true,
    },
  });
  const pushHooks = hooks.filter((hook) =>
    hook.events.length ? hook.events.includes('PUSH') : true,
  );
  if (!pushHooks.length) {
    return 0;
  }

  await prisma.repoWebhookDelivery.createMany({
    data: pushHooks.map((hook) => ({
      webhookId: hook.id,
      eventType: 'PUSH',
      status: 'QUEUED',
      payload: {
        ...input.payload,
        eventType: 'PUSH',
        queuedAt: new Date().toISOString(),
      },
      maxAttempts: hook.maxAttempts > 0 ? hook.maxAttempts : 5,
      nextAttemptAt: new Date(),
    })),
  });
  return pushHooks.length;
}
