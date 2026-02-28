# End-to-End Flow

This document explains how the system works from user action to persisted state.

## 1) Authentication and Session
1. User signs in from web UI.
2. API validates credentials and issues session/JWT context.
3. Protected routes call API with authenticated context.

## 2) Repository Read Flow
1. UI requests repo details by workspace/repo reference.
2. API resolves repo access (id or slug ref) and permission role.
3. API reads metadata from Postgres.
4. API reads git-derived details (tree/commits/languages) from repository storage.
5. UI renders repo page and navigation sections.

## 3) Repository Write Flow
1. User performs write action (file edit, branch, settings, delete).
2. API checks role requirements (`WRITE` or `ADMIN`).
3. API updates metadata in Postgres and git state in storage where needed.
4. UI receives result and updates local state/toast feedback.

## 4) Git over HTTP Flow
1. Git client hits git edge endpoint (`apps/git`).
2. Auth is validated via PAT/session rules.
3. Allowed operation (`upload-pack` or `receive-pack`) is executed against bare repo.
4. DB metadata remains authoritative for permissions and repository mapping.

## 5) Issue and Pull Request Flow
1. UI calls issue/pull API routes with workspace/repo refs.
2. API enforces repo-level access.
3. Data is stored/read in Postgres.
4. Notifications and timeline updates are created where applicable.

## 6) Import Automation Flow
1. User/API triggers import job (zip/remote).
2. Job is persisted and processed by worker.
3. Worker writes repository data to git storage.
4. API exposes status endpoints for polling and completion states.

## 7) Search Flow
1. Source changes or metadata updates produce indexable content.
2. OpenSearch stores searchable documents.
3. UI/API search endpoints query OpenSearch and return ranked results.

## 8) Failure Handling
- Access failures return explicit status/messages.
- Validation failures return 4xx with actionable reasons.
- Long-running failures are surfaced through job status and logs.

---
Written by Krishnam Murarka (km@edilec.com)

