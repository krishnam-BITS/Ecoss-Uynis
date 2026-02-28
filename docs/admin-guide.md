# Admin Guide

## 1) Admin Types

Uynis has two different admin layers:

- Repository/workspace admin:
  - Manages repo/workspace settings, members, webhooks, and content moderation inside allowed scopes.
  - This is a normal product role granted per workspace/repo.
- Platform admin (system admin):
  - Operates platform-level `/admin` routes.
  - Can inspect cross-tenant health, security events, users, workspaces, repos, PAT inventory, webhooks, and import jobs.

These are intentionally separate.

## 2) How System Admin Is Determined

System admin is configured through environment variables:

- `ADMIN_EMAILS` (comma-separated emails)
- `ADMIN_USER_IDS` (comma-separated user ids)
- `ALLOW_DEV_ADMIN_FALLBACK` (development-only fallback; keep `false` in production)

Implementation is enforced in `apps/api/src/routes/admin.ts`.

Runtime note:

- Uynis resolves system-admin config from the current repo `.env` first, then falls back to process environment values.
- This allows local and Docker-mounted development setups to pick up admin list changes immediately for admin checks.
- Prefer `ADMIN_USER_IDS` for production stability.

## 3) `/admin` Access Rules

Access is allowed only when both checks pass:

1. Authenticated identity is a configured system admin.
2. Request auth type is valid:
   - Session/JWT path: system admin identity required.
   - PAT path: PAT must include `platform:admin` scope (legacy `admin` treated as platform admin).

If checks fail, API returns `403`.

## 4) PAT Scope Model

Active scope evaluation (see `apps/api/src/lib/pat-auth.ts`):

- `repo:read`
- `repo:write`
- `repo:admin`
- `platform:admin`
- `admin` (legacy alias compatible with platform admin)

Scope hierarchy:

- `platform:admin` implies repo-admin/write/read checks.
- `repo:admin` implies repo-write/read.
- `repo:write` implies repo-read.

## 5) Admin Endpoints (Current)

`GET`:

- `/admin/health`
- `/admin/security/events`
- `/admin/security/state/:userId`
- `/admin/security/anomalies`
- `/admin/users`
- `/admin/workspaces`
- `/admin/repos`
- `/admin/pats`
- `/admin/webhooks`
- `/admin/import-jobs`

`POST`:

- `/admin/pats/:tokenId/revoke`

## 6) Operational Guidance

- Do not hardcode admin credentials in source.
- Keep `ALLOW_DEV_ADMIN_FALLBACK=false` outside local development.
- Prefer `ADMIN_USER_IDS` over email matching for production reliability.
- Audit admin PATs regularly and revoke stale tokens.

## 7) UI Guidance

- Non-system users should not see an admin nav entry.
- `/admin` route should render a forbidden state when checks fail.
- Admin UI actions should be logged and use explicit confirmations for destructive operations.

---
Written by Krishnam Murarka (km@edilec.com)

