import { Client } from '@opensearch-project/opensearch';
import { prisma } from '@uynis/db';
import { recordOpenSearchLatency } from './metrics.js';

const node = process.env.OPENSEARCH_URL?.trim();
const client = node ? new Client({ node }) : null;
const opensearchSlowQueryMs = Number.parseInt(
  process.env.OPENSEARCH_SLOW_QUERY_MS ?? '250',
  10,
);

const indices = {
  issues: process.env.OPENSEARCH_INDEX_ISSUES?.trim() || 'uynis-issues-v1',
  pulls: process.env.OPENSEARCH_INDEX_PULLS?.trim() || 'uynis-pulls-v1',
  discussionThreads:
    process.env.OPENSEARCH_INDEX_DISCUSSION_THREADS?.trim() ||
    'uynis-discussion-threads-v1',
  discussionMessages:
    process.env.OPENSEARCH_INDEX_DISCUSSION_MESSAGES?.trim() ||
    'uynis-discussion-message-threads-v1',
  discussionChannels:
    process.env.OPENSEARCH_INDEX_DISCUSSION_CHANNELS?.trim() ||
    'uynis-discussion-channels-v1',
  discussionCalls:
    process.env.OPENSEARCH_INDEX_DISCUSSION_CALLS?.trim() ||
    'uynis-discussion-calls-v1',
} as const;

type SearchIdsResult = {
  ids: string[];
  usedOpenSearch: boolean;
};

let ensurePromise: Promise<void> | null = null;
let didLogFallback = false;

function shouldLogSlowQuery(durationMs: number) {
  return (
    Number.isFinite(opensearchSlowQueryMs) &&
    opensearchSlowQueryMs > 0 &&
    durationMs >= opensearchSlowQueryMs
  );
}

function logSlowQuery(index: string, durationMs: number, mode: string) {
  if (!shouldLogSlowQuery(durationMs)) {
    return;
  }
  console.warn(
    `[search] slow query index=${index} mode=${mode} durationMs=${durationMs}`,
  );
}

function logFallback(message: string) {
  if (didLogFallback) {
    return;
  }
  didLogFallback = true;
  console.warn(`[search] OpenSearch fallback active: ${message}`);
}

function toSearchPayload<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    return (response as { body: T }).body;
  }
  return response as T;
}

export function isOpenSearchConfigured() {
  return Boolean(client);
}

export async function checkOpenSearchReadiness() {
  if (!client) {
    return { ok: false as const, message: 'OpenSearch is not configured.' };
  }
  try {
    const startedAt = Date.now();
    await client.ping();
    const durationMs = Date.now() - startedAt;
    recordOpenSearchLatency(durationMs / 1000);
    logSlowQuery('_cluster/ping', durationMs, 'ping');
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : 'OpenSearch ping failed.',
    };
  }
}

async function ensureIndices() {
  if (!client) {
    return;
  }
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    await Promise.all([
      client.indices.create(
        {
          index: indices.issues,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                workspaceId: { type: 'keyword' },
                repoId: { type: 'keyword' },
                title: { type: 'text' },
                body: { type: 'text' },
                authorName: { type: 'text' },
                authorEmail: { type: 'keyword' },
                authorUsername: { type: 'keyword' },
                labelNames: { type: 'keyword' },
                status: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
      client.indices.create(
        {
          index: indices.pulls,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                workspaceId: { type: 'keyword' },
                repoId: { type: 'keyword' },
                title: { type: 'text' },
                body: { type: 'text' },
                sourceBranch: { type: 'keyword' },
                targetBranch: { type: 'keyword' },
                authorName: { type: 'text' },
                authorEmail: { type: 'keyword' },
                authorUsername: { type: 'keyword' },
                labelNames: { type: 'keyword' },
                status: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
      client.indices.create(
        {
          index: indices.discussionThreads,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                title: { type: 'text' },
                workspaceName: { type: 'text' },
                repoName: { type: 'text' },
                category: { type: 'keyword' },
                status: { type: 'keyword' },
                updatedAt: { type: 'date' },
                createdAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
      client.indices.create(
        {
          index: indices.discussionMessages,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                name: { type: 'text' },
                preview: { type: 'text' },
                updatedAt: { type: 'date' },
                createdAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
      client.indices.create(
        {
          index: indices.discussionChannels,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                name: { type: 'text' },
                topic: { type: 'text' },
                visibility: { type: 'keyword' },
                updatedAt: { type: 'date' },
                createdAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
      client.indices.create(
        {
          index: indices.discussionCalls,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                title: { type: 'text' },
                host: { type: 'text' },
                status: { type: 'keyword' },
                startsAt: { type: 'date' },
                updatedAt: { type: 'date' },
                createdAt: { type: 'date' },
              },
            },
          },
        },
        { ignore: [400] },
      ),
    ]);
  })();

  try {
    await ensurePromise;
  } catch (error) {
    ensurePromise = null;
    throw error;
  }
}

async function searchIds(input: {
  index: string;
  q: string;
  fields: string[];
  limit?: number;
  filters?: Array<Record<string, unknown>>;
}): Promise<SearchIdsResult> {
  if (!client) {
    logFallback('OPENSEARCH_URL is not configured.');
    return { ids: [], usedOpenSearch: false };
  }
  try {
    await ensureIndices();
    const startedAt = Date.now();
    console.info(`[search] opensearch query index=${input.index}`);
    const response = await client.search({
      index: input.index,
      size: Math.max(1, Math.min(input.limit ?? 50, 200)),
      body: {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: input.q,
                  fields: input.fields,
                  operator: 'and',
                },
              },
            ],
            filter: input.filters ?? [],
          },
        },
      },
    });
    const payload = toSearchPayload<{
      hits?: { hits?: Array<{ _id?: string; _source?: { id?: string } }> };
    }>(response);
    const hits = payload.hits?.hits ?? [];
    const ids = hits
      .map((hit) => hit._id ?? hit._source?.id)
      .filter((value): value is string => Boolean(value));
    const durationMs = Date.now() - startedAt;
    recordOpenSearchLatency(durationMs / 1000);
    logSlowQuery(input.index, durationMs, 'search');
    return {
      ids,
      usedOpenSearch: true,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OpenSearch error';
    logFallback(message);
    return { ids: [], usedOpenSearch: false };
  }
}

async function indexDocument(index: string, id: string, body: Record<string, unknown>) {
  if (!client) {
    return false;
  }
  try {
    await ensureIndices();
    await client.index({
      index,
      id,
      refresh: 'wait_for',
      body,
    });
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OpenSearch error';
    logFallback(message);
    return false;
  }
}

async function deleteDocument(index: string, id: string) {
  if (!client) {
    return false;
  }
  try {
    await ensureIndices();
    await client.delete(
      {
        index,
        id,
        refresh: 'wait_for',
      },
      { ignore: [404] },
    );
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown OpenSearch error';
    logFallback(message);
    return false;
  }
}

export async function indexIssueById(issueId: string) {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: {
      id: true,
      repoId: true,
      title: true,
      body: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      repo: {
        select: {
          workspaceId: true,
        },
      },
      author: {
        select: {
          name: true,
          email: true,
          username: true,
        },
      },
      labels: {
        select: {
          label: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });
  if (!issue) {
    return deleteDocument(indices.issues, issueId);
  }

  return indexDocument(indices.issues, issue.id, {
    id: issue.id,
    workspaceId: issue.repo.workspaceId,
    repoId: issue.repoId,
    title: issue.title,
    body: issue.body ?? '',
    authorName: issue.author.name ?? '',
    authorEmail: issue.author.email ?? '',
    authorUsername: issue.author.username ?? '',
    labelNames: issue.labels.map((entry) => entry.label.name),
    status: issue.status,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  });
}

export async function indexPullById(pullId: string) {
  const pull = await prisma.pullRequest.findUnique({
    where: { id: pullId },
    select: {
      id: true,
      repoId: true,
      title: true,
      body: true,
      status: true,
      sourceBranch: true,
      targetBranch: true,
      createdAt: true,
      updatedAt: true,
      repo: {
        select: {
          workspaceId: true,
        },
      },
      author: {
        select: {
          name: true,
          email: true,
          username: true,
        },
      },
      labels: {
        select: {
          label: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });
  if (!pull) {
    return deleteDocument(indices.pulls, pullId);
  }

  return indexDocument(indices.pulls, pull.id, {
    id: pull.id,
    workspaceId: pull.repo.workspaceId,
    repoId: pull.repoId,
    title: pull.title,
    body: pull.body ?? '',
    sourceBranch: pull.sourceBranch,
    targetBranch: pull.targetBranch,
    authorName: pull.author.name ?? '',
    authorEmail: pull.author.email ?? '',
    authorUsername: pull.author.username ?? '',
    labelNames: pull.labels.map((entry) => entry.label.name),
    status: pull.status,
    createdAt: pull.createdAt.toISOString(),
    updatedAt: pull.updatedAt.toISOString(),
  });
}

export async function indexDiscussionThreadById(threadId: string) {
  const thread = await prisma.discussionThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      title: true,
      workspaceName: true,
      repoName: true,
      category: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!thread) {
    return deleteDocument(indices.discussionThreads, threadId);
  }
  return indexDocument(indices.discussionThreads, thread.id, {
    id: thread.id,
    title: thread.title,
    workspaceName: thread.workspaceName,
    repoName: thread.repoName,
    category: thread.category,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  });
}

export async function indexDiscussionMessageThreadById(threadId: string) {
  const thread = await prisma.discussionMessageThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      name: true,
      preview: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!thread) {
    return deleteDocument(indices.discussionMessages, threadId);
  }
  return indexDocument(indices.discussionMessages, thread.id, {
    id: thread.id,
    name: thread.name,
    preview: thread.preview,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
  });
}

export async function indexDiscussionChannelById(channelId: string) {
  const channel = await prisma.discussionChannel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      name: true,
      topic: true,
      visibility: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!channel) {
    return deleteDocument(indices.discussionChannels, channelId);
  }
  return indexDocument(indices.discussionChannels, channel.id, {
    id: channel.id,
    name: channel.name,
    topic: channel.topic,
    visibility: channel.visibility,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  });
}

export async function indexDiscussionCallById(callId: string) {
  const call = await prisma.discussionCall.findUnique({
    where: { id: callId },
    select: {
      id: true,
      title: true,
      host: true,
      status: true,
      startsAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!call) {
    return deleteDocument(indices.discussionCalls, callId);
  }
  return indexDocument(indices.discussionCalls, call.id, {
    id: call.id,
    title: call.title,
    host: call.host,
    status: call.status,
    startsAt: call.startsAt.toISOString(),
    createdAt: call.createdAt.toISOString(),
    updatedAt: call.updatedAt.toISOString(),
  });
}

export async function searchIssueIds(input: {
  q: string;
  workspaceId?: string;
  repoId?: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  const filters: Array<Record<string, unknown>> = [];
  if (input.workspaceId) {
    filters.push({ term: { workspaceId: input.workspaceId } });
  }
  if (input.repoId) {
    filters.push({ term: { repoId: input.repoId } });
  }
  return searchIds({
    index: indices.issues,
    q: input.q,
    fields: ['title^4', 'body^2', 'authorName^1.5', 'authorEmail', 'labelNames^2'],
    limit: input.limit,
    filters,
  });
}

export async function searchPullIds(input: {
  q: string;
  workspaceId?: string;
  repoId?: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  const filters: Array<Record<string, unknown>> = [];
  if (input.workspaceId) {
    filters.push({ term: { workspaceId: input.workspaceId } });
  }
  if (input.repoId) {
    filters.push({ term: { repoId: input.repoId } });
  }
  return searchIds({
    index: indices.pulls,
    q: input.q,
    fields: [
      'title^4',
      'body^2',
      'sourceBranch',
      'targetBranch',
      'authorName^1.5',
      'authorEmail',
      'labelNames^2',
    ],
    limit: input.limit,
    filters,
  });
}

export async function searchDiscussionThreadIds(input: {
  q: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  return searchIds({
    index: indices.discussionThreads,
    q: input.q,
    fields: ['title^3', 'workspaceName^1.5', 'repoName^1.5'],
    limit: input.limit,
  });
}

export async function searchDiscussionMessageThreadIds(input: {
  q: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  return searchIds({
    index: indices.discussionMessages,
    q: input.q,
    fields: ['name^3', 'preview^2'],
    limit: input.limit,
  });
}

export async function searchDiscussionChannelIds(input: {
  q: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  return searchIds({
    index: indices.discussionChannels,
    q: input.q,
    fields: ['name^3', 'topic^2'],
    limit: input.limit,
  });
}

export async function searchDiscussionCallIds(input: {
  q: string;
  limit?: number;
}): Promise<SearchIdsResult> {
  return searchIds({
    index: indices.discussionCalls,
    q: input.q,
    fields: ['title^3', 'host^2'],
    limit: input.limit,
  });
}
