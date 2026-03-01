# Getting Started

This guide is for a fresh machine where someone downloads the repository and wants a working system.

## Prerequisites
- Docker + Docker Compose
- Node.js 20+ (for local dev commands)
- pnpm 9+
- Git

## 1) Clone and enter
```bash
git clone <repo-url>
cd uynis
```

## 2) Configure environment
```bash
cp .env.example .env
```
Then update secrets and URLs in `.env` as required.

## 3) Start infrastructure and services
```bash
docker compose -f infra/docker-compose.yml up -d
```

## 4) Verify health
```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
```

## 5) Start local app stack (optional local mode)
```bash
pnpm install
pnpm dev
```

## Core URLs
- Web UI: `http://localhost:3000`
- API: `http://localhost:4000`
- Git HTTP edge: `http://localhost:4001`

## First PAT for automation
1. Log in to the web UI.
2. Open `Settings -> Developer`.
3. Create PAT with required scope (`repo:read`, `repo:write`, or admin scope as needed).
4. Copy token once and store it safely.

## Quick Git over HTTP test
```bash
git clone http://localhost:4001/<workspace>/<repo>.git
```
The edge now includes a `WWW-Authenticate: Basic` challenge, so Git will
prompt for credentials if the repo is private.  enter your username and
use the **full token** (including the `uynis_pat_` prefix) as the
password.  You may also embed them in the URL, e.g.

```bash
git clone http://<username>:<full-token>@localhost:4001/<workspace>/<repo>.git
```

## Next documentation
- Architecture: `docs/architecture-overview.md`
- System operations: `docs/system-operations.md`
- Deployment: `docs/deployment.md`
- Developer automation: `docs/developer-guide.md`
- SDK usage: `docs/sdk-usage.md`
- CLI usage: `docs/cli-usage.md`

---
Written by Krishnam Murarka (km@edilec.com)

