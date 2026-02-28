# Deployment Guide

For a full domain + public rollout workflow (including CLI/SDK distribution), also see:

- `docs/production-rollout.md`

## 1) Deployment Model

Uynis is deployed as a multi-service stack:

- `web` (Next.js UI)
- `api` (Fastify metadata/business API)
- `git-storage` (Git HTTP edge + internal repo RPC)
- `worker` (background jobs)
- `postgres`
- `redis`
- `minio`
- `opensearch`

Compose baseline is defined in `infra/docker-compose.yml`.

## Container Responsibilities

- `uynis-web`: Next.js frontend (`:3000`) that calls API/Git services.
- `uynis-api`: Fastify API (`:4000`) for auth, workspaces, repos, issues, pulls, admin.
- `uynis-worker`: background jobs (imports, retries, async processing).
- `uynis-git-storage`: Git HTTP edge (`:4001`) and internal repo RPC.
- `uynis-postgres`: primary metadata database.
- `uynis-redis`: cache/session/rate-limit backend.
- `uynis-minio`: object storage for uploads/attachments.
- `uynis-opensearch`: search index/query service.

## 2) Prerequisites

- Docker + Docker Compose plugin
- Linux host recommended for production
- Persistent storage for database/object/git/search volumes
- TLS termination (reverse proxy or ingress)

## 3) Environment Baseline

Use `.env.example` as baseline and define production values for:

- `JWT_SECRET`
- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_UPLOADS`
- `OPENSEARCH_URL`
- `INTERNAL_RPC_TOKEN`
- `ADMIN_EMAILS` and/or `ADMIN_USER_IDS`
- `ALLOW_DEV_ADMIN_FALLBACK=false`

Important for Docker:
- `DATABASE_URL_DOCKER` must target `postgres:5432` (container DNS), not `localhost`.
- `DATABASE_URL` can stay host-local (`localhost:5433`) for non-container local tooling.

## 4) First Boot

```bash
docker compose -f infra/docker-compose.yml pull
docker compose -f infra/docker-compose.yml up -d
```

Health checks:

```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
curl http://localhost:4000/ready
curl http://localhost:4001/ready
```

## 5) Domain + Reverse Proxy

Expose externally through HTTPS reverse proxy:

- `https://app.example.com` -> `web:3000`
- `https://api.example.com` -> `api:4000`
- `https://git.example.com` -> `git-storage:4001`

Update public web env:

- `NEXT_PUBLIC_API_URL=https://api.example.com`
- `NEXT_PUBLIC_GIT_URL=https://git.example.com`

Use TLS certificates (Let's Encrypt or managed certs).

## 6) Persistence and Backups

Persist these volumes:

- Postgres data
- MinIO data
- OpenSearch data
- Git repo storage (`/var/lib/uynis/repos`)

Recommended backups:

- Postgres logical backup (`pg_dump`)
- MinIO bucket backup/sync
- Git repo volume snapshot
- OpenSearch snapshot policy

## 7) Upgrade Procedure

1. Backup DB + object + repo volumes.
2. Pull new images / latest code.
3. Apply DB changes if needed.
4. Restart services:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

5. Re-run health/readiness checks.

## 8) Security Baseline

- Keep admin fallback disabled in production.
- Restrict internal networks for DB/Redis/MinIO/OpenSearch.
- Rotate secrets periodically.
- Use PAT scopes minimally required per integration.

## 9) Observability

At minimum monitor:

- `/health` and `/ready`
- container restart counts
- API/Git edge logs
- worker failure/retry logs

Consider central logging + metrics scraping in production.

## 10) Common Failure: `P1001` From API Container

Symptom:
- API exits with `Error: P1001: Can't reach database server at localhost:5433`.

Cause:
- Inside containers, `localhost` refers to the same container, not Postgres.

Fix:
1. Ensure compose uses `DATABASE_URL_DOCKER=postgresql://postgres:postgres@postgres:5432/uynis`.
2. Recreate services:
```bash
docker compose --env-file .env -f infra/docker-compose.yml up -d --force-recreate api worker
```
3. Verify:
```bash
curl http://localhost:4000/health
```

---
Written by Krishnam Murarka (km@edilec.com)

