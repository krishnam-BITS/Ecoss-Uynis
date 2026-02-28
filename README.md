# ECOSS-UYNIS

ECOSS-UYNIS is a self-hosted collaboration platform with repository hosting, issues, pull requests, chat discussions, notifications, and workspace management.

## At A Glance

| Surface | Purpose |
| --- | --- |
| Web (`apps/web`) | User/admin GUI |
| API (`apps/api`) | Core business logic and auth |
| Git Edge (`apps/git`) | Git over HTTP + repo read RPC |
| Worker (`apps/api` worker mode) | Background jobs and retries |
| CLI (`packages/cli`) | Terminal automation workflows |
| SDK (`packages/sdk`) | Programmatic API integration |

## Core Architecture

Uynis follows a strict service-boundary model:

- `Git = code` (bare repos via `git-http-backend`)
- `Postgres = metadata` (users, repos, issues, PRs, settings, audit metadata)
- `MinIO = binary objects` (uploads/attachments/avatars)
- `Redis = ephemeral state` (session cache, invalidation, rate-limiting/cache keys)
- `OpenSearch = search` (issues/pulls/discussions/code indexing)

Details: `docs/architecture-overview.md`

Database schema summary: `docs/database-schema-overview.md`

## Monorepo Layout

- `apps/web` -> Next.js portal/public UI
- `apps/api` -> Fastify API and worker entrypoints
- `apps/git` -> canonical Git HTTP edge and internal repo RPC
- `packages/db` -> Prisma schema/client/build helpers
- `packages/sdk` -> JS SDK helpers
- `packages/cli` -> standalone `uynis` terminal CLI
- `packages/ui` -> shared UI utilities/components

Complete file/folder reference: `docs/repo-structure.md`, `docs/file-catalog.md`

## Local Development

For a first-time setup walkthrough:
- `docs/getting-started.md`

### 1) Start infra + services

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2) Verify health

```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
```

### 3) Run app stack (if not already started via compose commands)

```bash
pnpm install
pnpm dev
```

### 4) Web quality checks

```bash
pnpm --filter @uynis/web lint
pnpm --filter @uynis/web build
```

Containerized checks:

```bash
docker compose -f infra/docker-compose.yml exec -T web pnpm --filter @uynis/web lint
docker compose -f infra/docker-compose.yml exec -T web pnpm --filter @uynis/web build
```

## Service Endpoints

- Web UI: `http://localhost:3000`
- API: `http://localhost:4000` (`/docs` for API docs if enabled)
- Git HTTP edge: `http://localhost:4001`
- Postgres: `localhost:5433`
- Redis: `localhost:6379`
- MinIO API/Console: `localhost:9000` / `localhost:9011`
- OpenSearch: `localhost:9200`

## Git Usage (Uynis Git Edge)

Clone via Git edge:

```bash
git clone http://localhost:4001/<workspace>/<repo>.git
```

- Public repos: clone without token
- Private repos: token required
- Push: requires write scope token

PAT usage:
- Username: any value
- Password: PAT token

## PAT and Security

- PAT scopes include read/write/admin-level scopes (see UI/API for exact active scope names).
- Tokens are shown once on creation; only token metadata is persisted afterward.
- Revoked/expired tokens are blocked by API and Git edge auth paths.

## OTP Delivery

Uynis now uses a real OTP pipeline:

- `apps/api/src/lib/otp-service.ts` owns OTP generation, hashing, verification, expiry, and resend lockout.
- `apps/api/src/lib/message-delivery.ts` owns delivery provider routing (`webhook`, `sendgrid`, `twilio`, or `auto`).
- `temp/` is an optional standalone delivery emulator used only for development while no real external provider is connected.

Behavior notes:

- OTP resend quota is only consumed after delivery is actually confirmed.
- If delivery cannot be confirmed, Uynis keeps the account unverified and shows a controlled message instead of a generic server error.
- The optional emulator being down should not crash the main signup or login flows.

For the full provider matrix, key handling, and emulator setup:

- `docs/developer-guide.md`
- `docs/env-reference.md`
- `temp/README.md`

Security and admin details:
- `docs/admin-guide.md`
- `docs/developer-guide.md`

## Documentation

- Documentation hub: `docs/README.md`
- Getting started: `docs/getting-started.md`
- Architecture: `docs/architecture-overview.md`
- Deployment and rollout: `docs/deployment.md`, `docs/production-rollout.md`
- CLI and SDK: `docs/cli-usage.md`, `docs/sdk-usage.md`
- Chat discussions: `docs/chat-system.md`
- File catalog: `docs/file-catalog.md`

## Notes

- If Next dev cache artifacts become inconsistent, clean web build cache and restart.

---
Written by Krishnam Murarka (km@edilec.com)
