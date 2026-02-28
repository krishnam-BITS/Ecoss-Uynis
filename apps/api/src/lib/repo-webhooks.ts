import { createHmac } from 'node:crypto';
import { prisma, type RepoWebhookEventType } from '@uynis/db';

const webhookDefaultTimeoutMs = Number.parseInt(
  process.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? '10000',
  10,
);
const webhookDefaultMaxAttempts = Number.parseInt(
  process.env.WEBHOOK_DELIVERY_MAX_ATTEMPTS ?? '5',
  10,
);
const webhookDeliveryBatchSize = Number.parseInt(
  process.env.WEBHOOK_DELIVERY_BATCH_SIZE ?? '20',
  10,
);
const webhookBackoffBaseMs = Number.parseInt(
  process.env.WEBHOOK_DELIVERY_BACKOFF_BASE_MS ?? '10000',
  10,
);
const webhookMaxBodyChars = Number.parseInt(
  process.env.WEBHOOK_DELIVERY_MAX_BODY_CHARS ?? '4000',
  10,
);

export const repoWebhookEventTypes = [
  'PUSH',
  'ISSUE_CREATED',
  'PULL_OPENED',
  'COMMENT_ADDED',
] as const;

type RepoWebhookEventInput = {
  repoId: string;
  eventType: RepoWebhookEventType;
  payload: Record<string, unknown>;
};

function extractRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as { requestId?: unknown }).requestId;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function nowIso() {
  return new Date().toISOString();
}

function trimBody(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.length > webhookMaxBodyChars
    ? `${value.slice(0, webhookMaxBodyChars)}...`
    : value;
}

function getDeliveryAttemptDelayMs(attemptCount: number) {
  const attempt = Math.max(1, attemptCount);
  const base = Number.isFinite(webhookBackoffBaseMs) && webhookBackoffBaseMs > 0
    ? webhookBackoffBaseMs
    : 10_000;
  const delay = base * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, 30 * 60 * 1000);
}

function signWebhookPayload(secretHash: string, payload: string) {
  return `sha256=${createHmac('sha256', secretHash).update(payload).digest('hex')}`;
}

function webhookHasEvent(events: RepoWebhookEventType[], eventType: RepoWebhookEventType) {
  if (!events.length) {
    return true;
  }
  return events.includes(eventType);
}

export async function enqueueRepoWebhookEvent(input: RepoWebhookEventInput) {
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

  const matchedHooks = hooks.filter((hook) => webhookHasEvent(hook.events, input.eventType));
  if (!matchedHooks.length) {
    return 0;
  }

  await prisma.repoWebhookDelivery.createMany({
    data: matchedHooks.map((hook) => ({
      webhookId: hook.id,
      eventType: input.eventType,
      payload: {
        ...input.payload,
        eventType: input.eventType,
        queuedAt: nowIso(),
      },
      status: 'QUEUED',
      maxAttempts:
        Number.isFinite(hook.maxAttempts) && hook.maxAttempts > 0
          ? hook.maxAttempts
          : webhookDefaultMaxAttempts,
      nextAttemptAt: new Date(),
    })),
  });

  return matchedHooks.length;
}

async function tryClaimDelivery(deliveryId: string) {
  const updated = await prisma.repoWebhookDelivery.updateMany({
    where: {
      id: deliveryId,
      status: 'QUEUED',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    data: {
      status: 'RUNNING',
      attemptCount: {
        increment: 1,
      },
    },
  });
  return updated.count > 0;
}

async function completeDelivery(input: {
  deliveryId: string;
  webhookId: string;
  success: boolean;
  attemptCount: number;
  maxAttempts: number;
  statusCode?: number;
  responseBody?: string | null;
  error?: string | null;
}) {
  if (input.success) {
    await prisma.$transaction([
      prisma.repoWebhookDelivery.update({
        where: { id: input.deliveryId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          responseStatus: input.statusCode ?? null,
          responseBody: trimBody(input.responseBody),
          error: null,
          nextAttemptAt: null,
        },
      }),
      prisma.repoWebhook.update({
        where: { id: input.webhookId },
        data: { lastDeliveryAt: new Date() },
      }),
    ]);
    return;
  }

  const shouldRetry = input.attemptCount < input.maxAttempts;
  await prisma.repoWebhookDelivery.update({
    where: { id: input.deliveryId },
    data: {
      status: shouldRetry ? 'QUEUED' : 'FAILED',
      nextAttemptAt: shouldRetry
        ? new Date(Date.now() + getDeliveryAttemptDelayMs(input.attemptCount))
        : null,
      responseStatus: input.statusCode ?? null,
      responseBody: trimBody(input.responseBody),
      error: input.error?.slice(0, 2000) ?? null,
    },
  });
}

async function deliverWebhook(deliveryId: string) {
  const delivery = await prisma.repoWebhookDelivery.findUnique({
    where: { id: deliveryId },
    include: {
      webhook: {
        include: {
          repo: {
            select: {
              id: true,
              slug: true,
              workspace: {
                select: {
                  id: true,
                  slug: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!delivery || delivery.status !== 'RUNNING') {
    return;
  }

  const requestId = extractRequestId(delivery.payload);
  console.info(
    `[webhook-delivery] attempt deliveryId=${delivery.id} webhookId=${delivery.webhookId} requestId=${requestId ?? 'n/a'} attempt=${delivery.attemptCount}/${delivery.maxAttempts}`,
  );

  const secret = await prisma.repoWebhookSecret.findUnique({
    where: { repoId: delivery.webhook.repoId },
    select: { secretHash: true },
  });
  if (!secret?.secretHash) {
    await completeDelivery({
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      success: false,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      error: 'Webhook secret is not configured for this repository.',
    });
    return;
  }

  const payload = JSON.stringify(delivery.payload ?? {});
  const signature = signWebhookPayload(secret.secretHash, payload);
  const timeoutMs =
    Number.isFinite(delivery.webhook.timeoutMs) && delivery.webhook.timeoutMs > 0
      ? delivery.webhook.timeoutMs
      : webhookDefaultTimeoutMs;

  let responseStatus: number | undefined;
  let responseBody: string | null = null;
  try {
    const response = await fetch(delivery.webhook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-uynis-event': delivery.eventType,
        'x-uynis-delivery': delivery.id,
        'x-uynis-signature-256': signature,
      },
      body: payload,
      signal: AbortSignal.timeout(timeoutMs),
    });
    responseStatus = response.status;
    responseBody = trimBody(await response.text());
    await completeDelivery({
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      success: response.ok,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      statusCode: response.status,
      responseBody,
      error: response.ok ? null : `Webhook endpoint responded with ${response.status}.`,
    });
    console.info(
      `[webhook-delivery] completed deliveryId=${delivery.id} webhookId=${delivery.webhookId} requestId=${requestId ?? 'n/a'} status=${response.ok ? 'DELIVERED' : 'FAILED'} responseStatus=${response.status}`,
    );
  } catch (error) {
    await completeDelivery({
      deliveryId: delivery.id,
      webhookId: delivery.webhookId,
      success: false,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      statusCode: responseStatus,
      responseBody,
      error: error instanceof Error ? error.message : 'Webhook delivery failed.',
    });
    console.warn(
      `[webhook-delivery] failed deliveryId=${delivery.id} webhookId=${delivery.webhookId} requestId=${requestId ?? 'n/a'} error=${error instanceof Error ? error.message : 'Webhook delivery failed.'}`,
    );
  }
}

export async function processPendingWebhookDeliveries() {
  const pending = await prisma.repoWebhookDelivery.findMany({
    where: {
      status: 'QUEUED',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
    take:
      Number.isFinite(webhookDeliveryBatchSize) && webhookDeliveryBatchSize > 0
        ? webhookDeliveryBatchSize
        : 20,
    select: {
      id: true,
    },
  });

  for (const delivery of pending) {
    const claimed = await tryClaimDelivery(delivery.id);
    if (!claimed) {
      continue;
    }
    await deliverWebhook(delivery.id);
  }
}
