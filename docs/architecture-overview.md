# Uynis Architecture Overview

## 1) Service Responsibilities

### Web (`apps/web`)
- Next.js App Router UI
- Public and authenticated portal surfaces
- Calls API only; does not directly read DB or Git internals

### API (`apps/api`)
- Core business logic and metadata APIs
- Auth/session/PAT enforcement
- Issue/PR/workspace/repo/admin endpoints
- Internal RPC client for repo read operations

### Git Storage Edge (`apps/git`)
- Canonical Git HTTP edge (`:4001`) using `git-http-backend`
- Internal repo read RPC for tree/blob/commit reads
- Shared repo storage mount (`/var/lib/uynis/repos`)

### Worker (`apps/api` worker mode)
- Background jobs
- Import processing
- Webhook delivery retries/backoff
- Async indexing support

### Postgres
- Metadata source of truth
- Users, workspaces, repos, permissions, issues, pulls, tokens, notifications

### Redis
- Session cache/invalidation and short-lived platform state
- Rate limiting/cache primitives

### MinIO
- Object storage for uploads/attachments/avatars/import payloads

### OpenSearch
- Search index/query layer
- Used for issue/pull/discussion/code search paths

## 2) Canonical Principles

- Git code is never stored in Postgres as file blobs.
- Postgres stores metadata and relational state only.
- MinIO stores binary objects; API serves object URLs/proxy paths.
- Redis holds ephemeral/cache data only.
- Search routes should use OpenSearch-backed queries.

## 3) Network Topology (Local)

- Web -> API (`localhost:4000`)
- API -> Postgres, Redis, MinIO, OpenSearch
- API -> Git RPC (`git-storage:4001/internal/rpc/*`)
- Git clients -> Git edge (`localhost:4001`)

## 4) Repo Data Path

1. Git clone/fetch/push hit Git edge (`apps/git`).
2. Bare repositories live under shared repo mount.
3. API reads repo tree/blob/commits through internal RPC.
4. UI renders repository content from API responses.

## 5) Security Model Summary

- Session auth for web requests.
- PAT auth for API/Git-over-HTTP automation.
- Scope checks gate read/write/admin operations.
- Internal RPC protected by internal token and non-CORS internal routes.

---
Written by Krishnam Murarka (km@edilec.com)

