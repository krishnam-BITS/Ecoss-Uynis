# Production Rollout Guide

This guide explains how to make Uynis publicly accessible with domain routing, and how users can consume UI, Git, CLI, and SDK.

## 1) Target Architecture (Recommended First Production)

Use one server first:

- `web` (UI)
- `api` (REST backend)
- `git-storage` (Git-over-HTTP)
- `worker` (background jobs)
- `postgres`
- `redis`
- `minio`
- `opensearch`

All of them can run on the same server via Docker Compose.

## 2) Public Domain Model

Use subdomains:

- `app.yourdomain.com` -> web
- `api.yourdomain.com` -> api
- `git.yourdomain.com` -> git-storage

Create DNS `A` (or `AAAA`) records for all three subdomains pointing to your server IP.

## 3) Server Preparation

Install Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Deploy source:

```bash
git clone <your-repo-url>
cd uynis
cp .env.example .env
```

## 4) Production Environment Settings

Set production-safe values in `.env`:

- Strong secrets:
  - `JWT_SECRET`
  - `UPLOAD_TOKEN_SECRET`
  - `INTERNAL_RPC_TOKEN`
- Public URLs:
  - `API_PUBLIC_URL=https://api.yourdomain.com`
  - `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`
  - `NEXT_PUBLIC_GIT_URL=https://git.yourdomain.com`
- Admin:
  - `ADMIN_EMAILS=<comma-separated-admin-emails>`
  - `ALLOW_DEV_ADMIN_FALLBACK=false`
- Storage:
  - `REPO_STORAGE_PATH=/var/lib/uynis/repos` (container path)
  - `S3_*` for MinIO/S3 object store

Important:
- In container mode, DB host should be `postgres`, not `localhost`.

## 5) Start Production Stack

```bash
docker compose -f infra/docker-compose.yml up -d
```

Check status:

```bash
docker compose -f infra/docker-compose.yml ps
curl http://localhost:4000/health
curl http://localhost:4000/ready
curl http://localhost:4001/health
```

## 6) Reverse Proxy and TLS

Put Nginx/Caddy/Traefik in front:

- Route `app.yourdomain.com` to web container port.
- Route `api.yourdomain.com` to API container port.
- Route `git.yourdomain.com` to git-storage container port.

Enable HTTPS certificates (Let's Encrypt).

Only expose `80/443` publicly from firewall. Keep DB/cache/internal ports private.

## 7) How End Users Consume the Platform

### UI users

- Open `https://app.yourdomain.com`
- Sign in and use web portal.

### Git users

Clone/push using:

```bash
git clone https://git.yourdomain.com/<workspace>/<repo>.git
```

Private repos:
- Git username: any string
- Git password: PAT token

## 8) CLI Distribution and Usage

Current repository CLI works with:

```bash
pnpm cli --help
```

For external users (no repo clone), publish CLI package and then users run:

```bash
npm i -g @uynis/cli
uynis config profile set --name prod --api https://api.yourdomain.com
uynis auth login --identifier you@example.com
uynis workspace list
```

To publish CLI from this monorepo:

1. In `packages/cli/package.json`, set:
   - `private: false`
   - version
   - proper package name (for example `@uynis/cli`)
2. Publish:

```bash
pnpm -C packages/cli publish --access public
```

## 9) SDK Distribution and Usage

For SDK consumers:

```bash
npm i @uynis/sdk
```

Example:

```ts
import { UynisClient } from '@uynis/sdk';

const client = new UynisClient({ baseUrl: 'https://api.yourdomain.com' });
await client.login('you@example.com', 'password');
const me = await client.getMe();
console.log(me);
```

To publish SDK:

1. In `packages/sdk/package.json`, set:
   - `private: false`
   - version
   - proper package name (for example `@uynis/sdk`)
2. Publish:

```bash
pnpm -C packages/sdk publish --access public
```

## 10) Backup and Operations

Back up regularly:

- Postgres data
- Git repo storage volume
- MinIO bucket
- OpenSearch snapshots

Monitor:

- `/health` and `/ready`
- container restart counts
- worker failure logs

## 11) Scale-out Path (Later)

When load grows, split by priority:

1. Managed Postgres
2. Managed Redis
3. External S3/object storage
4. Dedicated OpenSearch node
5. Separate app and git nodes

You do not need this on day 1.

---
Written by Krishnam Murarka (km@edilec.com)

