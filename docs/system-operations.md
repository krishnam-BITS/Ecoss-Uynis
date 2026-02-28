# System Operations Guide

## Start / Stop

### Start full stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

### Stop full stack

```bash
docker compose -f infra/docker-compose.yml down
```

### Stop and remove volumes (destructive)

```bash
docker compose -f infra/docker-compose.yml down -v
```

## Health Checks

```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
curl http://localhost:4000/ready
curl http://localhost:4001/ready
```

## Logs

```bash
docker compose -f infra/docker-compose.yml logs -f api
docker compose -f infra/docker-compose.yml logs -f web
docker compose -f infra/docker-compose.yml logs -f git-storage
docker compose -f infra/docker-compose.yml logs -f worker
```

## Migrations / DB

- Build DB package:

```bash
pnpm -C packages/db build
```

- Migration safety rule:
  - use forward-only migrations and re-run health checks after deploy.

## Common Troubleshooting

### Web build cache/chunk mismatch

```bash
pnpm -C apps/web clean
pnpm -C apps/web dev
```

### Verify compose services

```bash
docker compose -f infra/docker-compose.yml ps
```

### Validate UTF-8 for web sources

```bash
pnpm -C apps/web run check:utf8
```

## Backup and Recovery

Recommended before large changes:

```bash
git bundle create ../uynis_backup_<timestamp>.bundle --all
git diff > ../uynis_worktree_<timestamp>.patch
```

Restore from bundle:

```bash
git clone ../uynis_backup_<timestamp>.bundle restored-repo
```

---
Written by Krishnam Murarka (km@edilec.com)
