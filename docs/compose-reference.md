# Docker Compose Reference

This document explains `infra/docker-compose.yml` and `infra/docker-compose.internal.yml` in simple terms.

## Compose Files

- `infra/docker-compose.yml`
  - Full local/dev stack with host ports exposed.
- `infra/docker-compose.internal.yml`
  - Override file that removes host port publishing (`ports: []`) for internal-only networking.

Typical internal-only start:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.internal.yml up -d
```

## Service Overview

- `postgres`
  - Metadata database (users, workspaces, repos, issues, PRs, PAT metadata, etc).
- `redis`
  - Cache/session and transient coordination state.
- `minio`
  - S3-compatible object storage for uploads/attachments.
- `opensearch`
  - Search engine for indexed search.
- `git-storage`
  - Git-over-HTTP service and git storage edge.
- `api`
  - Main Fastify application backend.
- `worker`
  - Background job processor (imports/webhooks/async work).
- `web`
  - Next.js frontend.

## Key Compose Fields

- `image`
  - Base container image (for example `node:20-bookworm`).
- `container_name`
  - Stable container name.
- `working_dir`
  - Directory where command runs.
- `command`
  - Startup command.
- `environment`
  - Environment variables injected into container.
- `ports`
  - Host-to-container published ports.
- `volumes`
  - Persistent data or code mounts.
- `depends_on`
  - Startup dependency order and health conditions.
- `healthcheck`
  - Readiness/liveness command.

## Storage and Volumes in this Stack

- `uynis_postgres`
  - PostgreSQL data files.
- `uynis_redis`
  - Redis data.
- `uynis_minio`
  - MinIO object storage files.
- `uynis_opensearch`
  - OpenSearch index data.
- `uynis_git_repos`
  - Git repositories on container path `/var/lib/uynis/repos`.
- `uynis_api_uploads`
  - API uploads fallback path.
- `uynis_node_modules` and app/package-specific node_modules volumes
  - Keep container dependency directories persistent and separate from host runtime state.

## Why `git-storage` and `api` both touch repo path

- Git path is the canonical Git filesystem location.
- `git-storage` serves Git protocol operations.
- `api` may inspect/modify repo content for features such as imports, branch operations, metadata sync, and checks.
- Both services therefore need access to same repo storage volume/path.

## Internal vs External Exposure

With default compose:
- Services publish localhost ports for local testing.

With `docker-compose.internal.yml` overlay:
- Port publishing is disabled.
- Services remain reachable inside Docker network only.
- You usually add reverse proxy/gateway to expose only chosen endpoints.

## Production Deployment Pattern

1. Run this compose stack on server.
2. Keep app services internal where possible.
3. Put Nginx/Caddy/Traefik in front.
4. Route domains:
   - `app.example.com` -> web
   - `api.example.com` -> api
   - `git.example.com` -> git-storage
5. Enable TLS certificates.
6. Keep data in named volumes or mapped persistent host paths.

## Troubleshooting Basics

- API cannot connect to DB:
  - Confirm `DATABASE_URL_DOCKER` points to `postgres:5432` in container mode.
- Repo not found / storage issues:
  - Confirm `REPO_STORAGE_PATH` is set and shared volume is mounted.
- Upload issues:
  - Confirm MinIO/S3 credentials and bucket settings.
- Search unavailable:
  - Confirm OpenSearch health and `OPENSEARCH_URL`.

---
Written by Krishnam Murarka (km@edilec.com)

