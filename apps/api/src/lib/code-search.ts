import { Client } from '@opensearch-project/opensearch';
import { prisma } from '@uynis/db';
import { getRepoBlobRpc, getRepoTreeRpc } from './git-storage-client.js';
import { recordOpenSearchLatency } from './metrics.js';

const opensearchNode = process.env.OPENSEARCH_URL?.trim();
const codeSearchIndex = process.env.OPENSEARCH_INDEX_CODE?.trim() || 'uynis-code-v1';
const maxIndexedFileBytes = Number.parseInt(
  process.env.CODE_SEARCH_MAX_FILE_BYTES ?? '200000',
  10,
);
const maxIndexedFiles = Number.parseInt(
  process.env.CODE_SEARCH_MAX_FILES ?? '5000',
  10,
);
const maxIndexDepth = Number.parseInt(
  process.env.CODE_SEARCH_MAX_DEPTH ?? '20',
  10,
);
const opensearchSlowQueryMs = Number.parseInt(
  process.env.OPENSEARCH_SLOW_QUERY_MS ?? '250',
  10,
);

const client = opensearchNode ? new Client({ node: opensearchNode }) : null;
let ensureIndexPromise: Promise<void> | null = null;

function shouldLogSlowQuery(durationMs: number) {
  return (
    Number.isFinite(opensearchSlowQueryMs) &&
    opensearchSlowQueryMs > 0 &&
    durationMs >= opensearchSlowQueryMs
  );
}

function logSlowQuery(mode: string, durationMs: number) {
  if (!shouldLogSlowQuery(durationMs)) {
    return;
  }
  console.warn(
    `[search] slow code query mode=${mode} index=${codeSearchIndex} durationMs=${durationMs}`,
  );
}

type CodeSearchHit = {
  id: string;
  repoId: string;
  workspaceId: string;
  branch: string;
  path: string;
  sha: string;
  size: number;
  preview: string;
  score: number;
};

type ReindexCodeResult = {
  ok: boolean;
  repoId: string;
  workspaceId: string;
  branch: string;
  indexedFiles: number;
  skippedBinary: number;
  skippedBySize: number;
  truncated: boolean;
  source: 'opensearch' | 'disabled';
  message?: string;
};

function toSearchPayload<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'body' in response) {
    return (response as { body: T }).body;
  }
  return response as T;
}

function isBinaryLike(content: string) {
  return content.includes('\u0000');
}

function toPreview(input: string, fallback = '') {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}

function normalizePath(pathValue: string) {
  return pathValue.replace(/\\/g, '/').replace(/^\/+/, '');
}

function parsePositiveInt(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function ensureCodeSearchIndex() {
  if (!client) {
    return;
  }
  if (ensureIndexPromise) {
    await ensureIndexPromise;
    return;
  }

  ensureIndexPromise = client.indices
    .create(
      {
        index: codeSearchIndex,
        body: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              repoId: { type: 'keyword' },
              workspaceId: { type: 'keyword' },
              branch: { type: 'keyword' },
              path: { type: 'text' },
              pathKeyword: { type: 'keyword' },
              content: { type: 'text' },
              sha: { type: 'keyword' },
              size: { type: 'integer' },
              indexedAt: { type: 'date' },
            },
          },
        },
      },
      { ignore: [400] },
    )
    .then(() => undefined)
    .catch((error) => {
      ensureIndexPromise = null;
      throw error;
    });

  await ensureIndexPromise;
}

async function collectRepoBlobPaths(input: {
  repoId: string;
  branch: string;
  requestId?: string | null;
}) {
  const fileLimit = parsePositiveInt(maxIndexedFiles, 5000);
  const depthLimit = parsePositiveInt(maxIndexDepth, 20);

  const queue: Array<{ path: string; depth: number }> = [{ path: '', depth: 0 }];
  const paths: string[] = [];

  while (queue.length && paths.length < fileLimit) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    const tree = await getRepoTreeRpc({
      repoId: input.repoId,
      branch: input.branch,
      path: current.path,
    }, { requestId: input.requestId });

    for (const entry of tree.entries) {
      if (entry.type === 'tree') {
        if (current.depth + 1 <= depthLimit) {
          queue.push({ path: entry.path, depth: current.depth + 1 });
        }
        continue;
      }
      if (entry.type === 'blob') {
        paths.push(normalizePath(entry.path));
      }
      if (paths.length >= fileLimit) {
        break;
      }
    }
  }

  return { paths, truncated: queue.length > 0 };
}

async function deleteExistingRepoBranchDocs(input: { repoId: string; branch: string }) {
  if (!client) {
    return;
  }
  await client.deleteByQuery(
    {
      index: codeSearchIndex,
      body: {
        query: {
          bool: {
            filter: [{ term: { repoId: input.repoId } }, { term: { branch: input.branch } }],
          },
        },
      },
    },
    { ignore: [404] },
  );
}

export function isCodeSearchConfigured() {
  return Boolean(client);
}

export async function reindexRepoCodeById(input: {
  repoId: string;
  branch?: string | null;
  requestId?: string | null;
}) {
  const repo = await prisma.repo.findUnique({
    where: { id: input.repoId },
    select: {
      id: true,
      workspaceId: true,
      defaultBranch: true,
    },
  });
  if (!repo) {
    return {
      ok: false,
      repoId: input.repoId,
      workspaceId: '',
      branch: input.branch?.trim() || 'main',
      indexedFiles: 0,
      skippedBinary: 0,
      skippedBySize: 0,
      truncated: false,
      source: client ? 'opensearch' : 'disabled',
      message: 'Repository not found.',
    } satisfies ReindexCodeResult;
  }

  const branch = input.branch?.trim() || repo.defaultBranch || 'main';

  if (!client) {
    return {
      ok: false,
      repoId: repo.id,
      workspaceId: repo.workspaceId,
      branch,
      indexedFiles: 0,
      skippedBinary: 0,
      skippedBySize: 0,
      truncated: false,
      source: 'disabled',
      message: 'OpenSearch is not configured.',
    } satisfies ReindexCodeResult;
  }

  await ensureCodeSearchIndex();
  const { paths, truncated } = await collectRepoBlobPaths({
    repoId: repo.id,
    branch,
    requestId: input.requestId,
  });
  await deleteExistingRepoBranchDocs({ repoId: repo.id, branch });

  const byteLimit = parsePositiveInt(maxIndexedFileBytes, 200000);
  const operations: Array<Record<string, unknown>> = [];
  let skippedBinary = 0;
  let skippedBySize = 0;
  let indexedFiles = 0;

  for (const filePath of paths) {
    const blobResponse = await getRepoBlobRpc({
      repoId: repo.id,
      branch,
      path: filePath,
    }, { requestId: input.requestId });
    const blob = blobResponse.blob;
    if (!blob) {
      continue;
    }
    if (blob.isBinary) {
      skippedBinary += 1;
      continue;
    }
    if (blob.size > byteLimit) {
      skippedBySize += 1;
      continue;
    }

    const content = blob.content ?? '';
    if (!content || isBinaryLike(content)) {
      skippedBinary += 1;
      continue;
    }

    const docId = `${repo.id}:${branch}:${filePath}`;
    operations.push({
      index: {
        _index: codeSearchIndex,
        _id: docId,
      },
    });
    operations.push({
      id: docId,
      repoId: repo.id,
      workspaceId: repo.workspaceId,
      branch,
      path: filePath,
      pathKeyword: filePath,
      content,
      sha: blob.sha,
      size: blob.size,
      indexedAt: new Date().toISOString(),
    });
    indexedFiles += 1;
  }

  if (operations.length) {
    await client.bulk({
      index: codeSearchIndex,
      refresh: 'wait_for',
      body: operations,
    });
  }

  return {
    ok: true,
    repoId: repo.id,
    workspaceId: repo.workspaceId,
    branch,
    indexedFiles,
    skippedBinary,
    skippedBySize,
    truncated,
    source: 'opensearch',
  } satisfies ReindexCodeResult;
}

export async function searchRepoCode(input: {
  repoId: string;
  branch?: string | null;
  q: string;
  limit?: number;
}) {
  if (!client) {
    return {
      source: 'disabled' as const,
      results: [] as CodeSearchHit[],
    };
  }

  await ensureCodeSearchIndex();

  const limit = Math.max(1, Math.min(input.limit ?? 30, 100));
  const filters: Array<Record<string, unknown>> = [{ term: { repoId: input.repoId } }];
  if (input.branch?.trim()) {
    filters.push({ term: { branch: input.branch.trim() } });
  }

  const startedAt = Date.now();
  const response = await client.search({
    index: codeSearchIndex,
    size: limit,
    body: {
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: input.q,
                fields: ['path^4', 'content'],
              },
            },
          ],
          filter: filters,
        },
      },
      highlight: {
        pre_tags: [''],
        post_tags: [''],
        fields: {
          content: { fragment_size: 220, number_of_fragments: 1 },
          path: { fragment_size: 120, number_of_fragments: 1 },
        },
      },
    },
  });

  const payload = toSearchPayload<{
    hits?: {
      hits?: Array<{
        _score?: number;
        _source?: {
          id?: string;
          repoId?: string;
          workspaceId?: string;
          branch?: string;
          path?: string;
          sha?: string;
          size?: number;
          content?: string;
        };
        highlight?: {
          content?: string[];
          path?: string[];
        };
      }>;
    };
  }>(response);
  const durationMs = Date.now() - startedAt;
  recordOpenSearchLatency(durationMs / 1000);
  logSlowQuery('search', durationMs);

  const hits = payload.hits?.hits ?? [];
  const results: CodeSearchHit[] = hits
    .map((hit) => {
      const source = hit._source;
      if (
        !source?.id ||
        !source.repoId ||
        !source.workspaceId ||
        !source.branch ||
        !source.path ||
        !source.sha
      ) {
        return null;
      }
      return {
        id: source.id,
        repoId: source.repoId,
        workspaceId: source.workspaceId,
        branch: source.branch,
        path: source.path,
        sha: source.sha,
        size: source.size ?? 0,
        preview: toPreview(
          hit.highlight?.content?.[0] ?? hit.highlight?.path?.[0] ?? '',
          toPreview(source.content ?? ''),
        ),
        score: hit._score ?? 0,
      } satisfies CodeSearchHit;
    })
    .filter((item): item is CodeSearchHit => Boolean(item));

  return {
    source: 'opensearch' as const,
    results,
  };
}
