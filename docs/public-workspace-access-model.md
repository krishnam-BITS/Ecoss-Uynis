# Public Profiles, Workspaces, Repos, and Invites

This document explains the current access model in simple terms.

## 1) URL model

- Public user profile: `/{username}`
- Workspace page: `/workspaces/{workspaceSlug}`
- Repository page: `/workspaces/{workspaceSlug}/repos/{repoSlug}`

Why this works:

- `workspaceSlug` is globally unique.
- `repoSlug` is unique **inside** one workspace.
- So `workspaceSlug + repoSlug` gives a globally unique repository URL.

Example:

- `alice` personal workspace: `/workspaces/alice`
- Repo `api` in that workspace: `/workspaces/alice/repos/api`

---

## 2) Public vs private visibility

### Workspace visibility

Workspace settings now control public profile behavior:

- `publicProfileEnabled`
- `publicProfileShowDetails`

If public profile is disabled, non-members cannot view workspace details.

### Repository visibility

Repo visibility still uses:

- `PUBLIC`
- `PRIVATE`
- `INTERNAL` (team workspaces only)

And public repos also have:

- `publicReadRequiresAuth`

Meaning:

- `PUBLIC + publicReadRequiresAuth=false`: anyone can read.
- `PUBLIC + publicReadRequiresAuth=true`: must be logged in to read.
- `PRIVATE`: only users with granted access.
- `INTERNAL`: workspace members only.

---

## 3) Roles and permissions

Workspace roles:

- `OWNER`
- `ADMIN`
- `MEMBER`

Repo roles:

- `READ`
- `TRIAGE`
- `WRITE`
- `MAINTAIN`
- `ADMIN`

Permission resolution combines:

- workspace membership,
- workspace base repo policy,
- repo direct membership,
- team repo permissions,
- outside-collaborator policy.

Result: one effective repo role per user per repo.

---

## 4) Invite flow

Workspace invites support:

- invite by username, or
- invite by email.

If target user already exists:

- invite is linked to that user account.

If target user does not exist yet:

- invite is stored by email/username and can be accepted later after signup with matching identity.

Invite lifecycle:

- `PENDING -> ACCEPTED | DECLINED | EXPIRED | CANCELLED`

Public token link format:

- `/invites/{token}`

Optional email delivery:

- If `EMAIL_WEBHOOK_URL` is configured, invite creation also sends an email with the invite link.
- If webhook is not configured, invite still works via in-app copy/share link.

---

## 5) Auth redirect behavior

When session is missing/expired and auth is required:

- user is redirected to `/login?from={currentPath}`.

After login/signup:

- redirect returns to a safe internal path (`from` or `redirect` query param),
- so invite links and shared links continue correctly.

---

## 6) What members see in portal

If user accepts invite (or is added directly):

- workspace appears in `/workspaces`,
- workspace context can be selected,
- accessible repos appear in `/repositories` and workspace-scoped repo pages.

If user is not a member:

- private/internal content remains inaccessible,
- only permitted public pages are visible.

---
Written by Krishnam Murarka (km@edilec.com)

