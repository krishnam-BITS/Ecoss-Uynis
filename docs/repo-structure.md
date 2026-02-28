# Repository Structure

## Top-Level

- `apps/` -> runnable services/apps
- `packages/` -> shared libraries and build-time packages
- `infra/` -> docker-compose and local infra runtime definitions
- `docs/` -> architecture, operations, user/developer/admin documentation
- `scripts/` -> maintenance and one-off operational scripts
- `openapi/` -> API schema artifacts
- `data/` -> local runtime data (dev usage)
- `temp/` -> standalone OTP delivery emulator app (optional and disposable)

## `apps/`

- `apps/web/`
  - Next.js App Router frontend
  - Portal/public/auth experiences
  - UI state, route wiring, settings surfaces
- `apps/api/`
  - Fastify API server
  - auth/session/PAT enforcement
  - repo/workspace/issues/pulls/admin routes
  - worker entrypoint for async jobs
- `apps/git/`
  - Git HTTP edge (`git-http-backend`)
  - internal repo read RPC endpoints
  - shared bare repo storage access

## `packages/`

- `packages/db/`
  - Prisma schema/client generation and DB helpers
  - permission/access-resolution utilities
- `packages/sdk/`
  - SDK entrypoints/helpers for integrations
- `packages/cli/`
  - standalone `uynis` terminal CLI package
- `packages/shared/`
  - shared types/utilities used across services
- `packages/ui/`
  - shared UI helpers/components

## `infra/`

- `infra/docker-compose.yml`
  - local full-stack orchestration
  - service env wiring and shared volumes

## Root config files

- `pnpm-workspace.yaml` -> workspace package boundaries
- `turbo.json` -> turbo task orchestration
- `package.json` -> root scripts and dev dependencies
- `.env.example` -> baseline environment variable template
- `.editorconfig` -> consistent editor defaults

## `temp/`

- standalone, optional OTP delivery emulator
- separate server and frontend UI
- receives webhook deliveries from the API provider layer
- safe to delete later when switching to real external delivery providers

## Notes

- `node_modules/`, `.next/`, and local caches are runtime artifacts and not source-of-truth.
- Keep generated or temporary phase files out of long-term tracked source unless they are intentionally part of migration history.
- For a tracked-file inventory with per-file purpose, see `docs/file-catalog.md`.

---
Written by Krishnam Murarka (km@edilec.com)

