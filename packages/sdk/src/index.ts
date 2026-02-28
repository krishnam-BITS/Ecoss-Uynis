export type UynisClientOptions = {
  baseUrl?: string;
  token?: string;
  fetchFn?: typeof fetch;
};

export type CreateWorkspaceInput = {
  name: string;
  slug?: string;
};

export type CreateRepoInput = {
  name: string;
  visibility?: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
};

export type CommitChange = {
  path: string;
  content?: string;
  contentBase64?: string;
  delete?: boolean;
};

export type UploadFileInput = {
  path: string;
  content?: string;
  contentBase64?: string;
  data?: Blob | ArrayBuffer | Uint8Array;
};

export type CreateCommitInput = {
  branch?: string;
  message: string;
  changes: CommitChange[];
  authorName?: string;
  authorEmail?: string;
};

export type UploadFilesInput = {
  branch?: string;
  message: string;
  files: UploadFileInput[];
};

export type RepoImportJob = {
  id: string;
  repoId: string;
  createdById?: string | null;
  type: 'ZIP' | 'REMOTE';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  branch?: string | null;
  message?: string | null;
  importUrl?: string | null;
  archivePath?: string | null;
  importedFiles?: number | null;
  importedBranches?: number | null;
  defaultBranch?: string | null;
  commitSha?: string | null;
  error?: string | null;
  attempts?: number | null;
  maxAttempts?: number | null;
  nextRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ImportUploadResponse = {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
  maxBytes: number;
};

type RequestOptions = {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
};

function resolveFetch(fetchFn?: typeof fetch) {
  if (fetchFn) {
    return fetchFn;
  }
  if (typeof fetch !== 'undefined') {
    return fetch.bind(globalThis);
  }
  throw new Error('Fetch API is not available in this environment.');
}

function resolveDefaultBaseUrl(): string {
  const proc = globalThis as unknown as {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };
  const env = proc.process?.env;
  return env?.UYNIS_SDK_BASE_URL || env?.UYNIS_API_URL || 'http://localhost:4000';
}

function assertFormDataSupport() {
  if (typeof FormData === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('FormData and Blob are required for file uploads.');
  }
}

async function toBase64(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buffer: ArrayBuffer;
  if (data instanceof Blob) {
    buffer = await data.arrayBuffer();
  } else if (data instanceof ArrayBuffer) {
    buffer = data;
  } else {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }

  const bufferCtor = (globalThis as {
    Buffer?: { from: (data: ArrayBuffer) => { toString: (encoding: string) => string } };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(buffer).toString('base64');
  }

  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const btoaFn = (globalThis as { btoa?: (data: string) => string }).btoa;
  if (!btoaFn) {
    throw new Error('Base64 encoding is not supported in this environment.');
  }
  return btoaFn(binary);
}

async function normalizeUploadChange(file: UploadFileInput): Promise<CommitChange> {
  if (file.contentBase64) {
    return { path: file.path, contentBase64: file.contentBase64 };
  }
  if (file.data) {
    return {
      path: file.path,
      contentBase64: await toBase64(file.data),
    };
  }
  if (typeof file.content === 'string') {
    return { path: file.path, content: file.content };
  }
  throw new Error(`Missing content for ${file.path}`);
}

export class UynisClient {
  private baseUrl: string;
  private token: string | null;
  private fetchFn: typeof fetch;

  constructor(options: UynisClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? resolveDefaultBaseUrl();
    this.token = options.token ?? null;
    this.fetchFn = resolveFetch(options.fetchFn);
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ?? null,
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok) {
      const message = (data as { message?: string })?.message;
      throw new Error(message || `Request failed with ${response.status}`);
    }
    return data as T;
  }

  async login(identifier: string, password: string): Promise<string> {
    const data = await this.requestJson<{ token: string }>('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    this.token = data.token;
    return data.token;
  }

  async getMe() {
    return this.requestJson<{ user: Record<string, unknown> }>('/me');
  }

  async updateProfile(payload: {
    name?: string;
    bio?: string;
    location?: string;
    website?: string;
  }) {
    return this.requestJson<{ user: Record<string, unknown> }>('/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async uploadAvatar(file: Blob, filename = 'avatar.png') {
    assertFormDataSupport();
    const form = new FormData();
    form.append('avatar', file, filename);
    return this.requestJson<{ user: Record<string, unknown> }>('/me/avatar', {
      method: 'POST',
      body: form,
    });
  }

  async removeAvatar() {
    return this.requestJson<{ user: Record<string, unknown> }>('/me/avatar', {
      method: 'DELETE',
    });
  }

  async createWorkspace(payload: CreateWorkspaceInput) {
    return this.requestJson<{ workspace: Record<string, unknown> }>('/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async createRepo(workspaceId: string, payload: CreateRepoInput) {
    return this.requestJson<{ repo: Record<string, unknown> }>(`/workspaces/${workspaceId}/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async createCommit(workspaceId: string, repoId: string, payload: CreateCommitInput) {
    return this.requestJson<{ commit: Record<string, unknown> }>(
      `/workspaces/${workspaceId}/repos/${repoId}/commits`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  }

  async uploadFiles(workspaceId: string, repoId: string, payload: UploadFilesInput) {
    const changes = await Promise.all(payload.files.map(normalizeUploadChange));
    return this.createCommit(workspaceId, repoId, {
      branch: payload.branch,
      message: payload.message,
      changes,
    });
  }

  async importZip(
    workspaceId: string,
    repoId: string,
    archive: Blob,
    options?: { branch?: string; message?: string },
    filename = 'repository.zip',
  ) {
    assertFormDataSupport();
    const form = new FormData();
    form.append('archive', archive, filename);

    const params = new URLSearchParams();
    if (options?.branch) {
      params.set('branch', options.branch);
    }
    if (options?.message) {
      params.set('message', options.message);
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';

    return this.requestJson<{ commit: Record<string, unknown> }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import${suffix}`,
      {
        method: 'POST',
        body: form,
      },
    );
  }

  async importRemote(
    workspaceId: string,
    repoId: string,
    url: string,
    options?: { branch?: string },
  ) {
    return this.requestJson<{ importedBranches: number; defaultBranch: string }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/remote`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, branch: options?.branch }),
      },
    );
  }

  async setCommitCheck(
    workspaceId: string,
    repoId: string,
    sha: string,
    payload: { context: string; status: string; details?: string },
  ) {
    return this.requestJson<{ check: Record<string, unknown> }>(
      `/workspaces/${workspaceId}/repos/${repoId}/commits/${sha}/checks`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  }

  async createWebhookSecret(workspaceId: string, repoId: string) {
    return this.requestJson<{ secret: string }>(
      `/workspaces/${workspaceId}/repos/${repoId}/webhook-secret`,
      {
        method: 'POST',
      },
    );
  }

  async createImportUpload(
    workspaceId: string,
    repoId: string,
    payload: { fileName: string; contentType?: string; size?: number; maxAttempts?: number },
  ) {
    return this.requestJson<ImportUploadResponse>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/uploads`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  }

  async queueImportFromUpload(
    workspaceId: string,
    repoId: string,
    payload: { uploadId: string; branch?: string; message?: string; maxAttempts?: number },
  ) {
    return this.requestJson<{ job: RepoImportJob }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs/zip/from-upload`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
  }

  async queueImportZip(
    workspaceId: string,
    repoId: string,
    archive: Blob,
    options?: { branch?: string; message?: string; maxAttempts?: number },
    filename = 'repository.zip',
  ) {
    assertFormDataSupport();
    const form = new FormData();
    form.append('archive', archive, filename);

    const params = new URLSearchParams();
    if (options?.branch) {
      params.set('branch', options.branch);
    }
    if (options?.message) {
      params.set('message', options.message);
    }
    if (options?.maxAttempts) {
      params.set('maxAttempts', String(options.maxAttempts));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';

    return this.requestJson<{ job: RepoImportJob }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs/zip${suffix}`,
      {
        method: 'POST',
        body: form,
      },
    );
  }

  async queueImportRemote(
    workspaceId: string,
    repoId: string,
    url: string,
    options?: { branch?: string; maxAttempts?: number },
  ) {
    return this.requestJson<{ job: RepoImportJob }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs/remote`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, branch: options?.branch, maxAttempts: options?.maxAttempts }),
      },
    );
  }

  async getImportJob(workspaceId: string, repoId: string, jobId: string) {
    return this.requestJson<{ job: RepoImportJob }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs/${jobId}`,
    );
  }

  async listImportJobs(workspaceId: string, repoId: string) {
    return this.requestJson<{ jobs: RepoImportJob[] }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs`,
    );
  }

  async cancelImportJob(workspaceId: string, repoId: string, jobId: string) {
    return this.requestJson<{ job: RepoImportJob }>(
      `/workspaces/${workspaceId}/repos/${repoId}/import/jobs/${jobId}/cancel`,
      { method: 'POST' },
    );
  }

  async createPersonalAccessToken(payload: { name: string; scopes?: string[]; expiresInDays?: number }) {
    return this.requestJson<{ token: string; tokenInfo: Record<string, unknown> }>(`/me/pats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  async listPersonalAccessTokens() {
    return this.requestJson<{ tokens: Record<string, unknown>[] }>(`/me/pats`);
  }

  async revokePersonalAccessToken(tokenId: string) {
    return this.requestJson<{ revoked: boolean }>(`/me/pats/${tokenId}`, {
      method: 'DELETE',
    });
  }
}

