import { recordGitRpcLatency } from './metrics.js';

const gitStorageRpcUrl = process.env.GIT_STORAGE_RPC_URL ?? 'http://localhost:4001';

function getInternalRpcToken(): string {
  const token = process.env.INTERNAL_RPC_TOKEN?.trim() ?? '';
  if (!token) {
    throw new Error('INTERNAL_RPC_TOKEN is required for git-storage RPC.');
  }
  return token;
}

async function rpcFetch<T>(
  path: string,
  body: unknown,
  options?: { requestId?: string | null },
): Promise<T> {
  const startedAt = Date.now();
  const token = getInternalRpcToken();
  const response = await fetch(`${gitStorageRpcUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': token,
      ...(options?.requestId ? { 'x-request-id': options.requestId } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `git-storage RPC failed (${response.status}).`);
  }

  recordGitRpcLatency((Date.now() - startedAt) / 1000);
  return (await response.json()) as T;
}

type TreeEntry = {
  mode: string;
  type: 'tree' | 'blob';
  sha: string;
  size: number | null;
  name: string;
  path: string;
};

type RepoBlob = {
  path: string;
  branch: string;
  sha: string;
  size: number;
  isBinary: boolean;
  content: string | null;
  contentBase64: string | null;
};

type CommitInfo = {
  sha: string;
  author: string;
  date: string;
  message: string;
};

export async function getRepoTreeRpc(input: {
  repoId: string;
  branch: string;
  path: string;
}, options?: { requestId?: string | null }): Promise<{ branch: string; path: string; entries: TreeEntry[] }> {
  return rpcFetch('/internal/rpc/tree', input, options);
}

export async function getRepoBlobRpc(input: {
  repoId: string;
  branch: string;
  path: string;
}, options?: { requestId?: string | null }): Promise<{ blob: RepoBlob }> {
  return rpcFetch('/internal/rpc/blob', input, options);
}

export async function getRepoCommitsRpc(input: {
  repoId: string;
  branch: string;
  limit: number;
}, options?: { requestId?: string | null }): Promise<{ commits: CommitInfo[]; branch: string; limit: number }> {
  return rpcFetch('/internal/rpc/commits', input, options);
}
