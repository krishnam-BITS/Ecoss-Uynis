# Uynis SDK (Internal)

This SDK is a thin wrapper over the REST API for automation and integrations.

Base URL resolution order:

1. `new UynisClient({ baseUrl: ... })`
2. environment `UYNIS_SDK_BASE_URL`
3. environment `UYNIS_API_URL`
4. default `http://localhost:4000`

## Quick Start

```ts
import { UynisClient } from '@uynis/sdk';

const client = new UynisClient({ baseUrl: 'http://localhost:4000' });
const token = await client.login('you@example.com', 'password');

const workspace = await client.createWorkspace({ name: 'Acme', slug: 'acme' });
const repo = await client.createRepo(workspace.workspace.id, { name: 'web', visibility: 'PRIVATE' });

await client.uploadFiles(workspace.workspace.id, repo.repo.id, {
  branch: 'main',
  message: 'Initial import',
  files: [
    { path: 'README.md', content: '# Hello' },
  ],
});
```

Docker note:
- If SDK code runs inside a Docker service on the same compose network, use internal API DNS (for example `http://api:4000`).
- If SDK code runs on host machine, use public/host endpoint (for example `http://localhost:4000` or your production domain).

## Import a Codebase

```ts
// Import a zip archive into an empty repo
const archive = new Blob([zipBuffer]);
await client.importZip(workspaceId, repoId, archive, { branch: 'main', message: 'Import repo' });

// Import from a public Git URL
await client.importRemote(workspaceId, repoId, 'https://github.com/example/workspace-repo.git');
```

## Async Import Jobs

```ts
const { job } = await client.queueImportZip(workspaceId, repoId, archive, {
  branch: 'main',
  message: 'Async import',
  maxAttempts: 3,
});

// Poll until COMPLETED or FAILED
const status = await client.getImportJob(workspaceId, repoId, job.id);
```

```ts
// Cancel a queued import
await client.cancelImportJob(workspaceId, repoId, job.id);
```

## Signed Uploads (Large Archives)

```ts
// 1) Ask for a signed upload URL
const upload = await client.createImportUpload(workspaceId, repoId, {
  fileName: 'repo.zip',
  contentType: 'application/zip',
  size: archive.size,
  maxAttempts: 3,
});

// 2) Upload directly to the signed URL (no auth header required)
await fetch(upload.uploadUrl, {
  method: 'PUT',
  headers: { 'content-type': 'application/zip' },
  body: archive,
});

// 3) Queue import from that uploaded archive
const queued = await client.queueImportFromUpload(workspaceId, repoId, {
  uploadId: upload.uploadId,
  branch: 'main',
  message: 'Import via signed upload',
});
```

## Upload or Replace a File

```ts
await client.uploadFiles(workspaceId, repoId, {
  branch: 'main',
  message: 'Add logo',
  files: [
    { path: 'assets/logo.png', data: logoFileBlob },
  ],
});
```

## Profile Avatar (File Only)

```ts
await client.uploadAvatar(avatarBlob, 'avatar.png');
await client.removeAvatar();
```

Notes:
- For large repositories or long histories, use Git push (HTTP) with a PAT.
- Branch rules can block direct commits; if required, open a pull request instead.

---
Written by Krishnam Murarka (km@edilec.com)

