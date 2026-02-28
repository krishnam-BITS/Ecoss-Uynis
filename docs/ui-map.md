# UI Map

This document maps the active UI surface in the current Uynis runtime.

## Public Routes
- `/` and `/home`: landing page
- `/login`: sign-in
- `/signup`: account creation
- `/help`: help content
- `/terms`: terms and legal
- `/forgot-id`, `/forgot-password`: account recovery helpers
- `/private`, `/private/recover`: private account onboarding/recovery flow

## Authenticated Routes
- `/`: dashboard/home
- `/issues`: issue inbox
- `/pulls`: pull request inbox
- `/projects`: project overview
- `/repositories`: repository listing
- `/workspaces`: workspace directory
- `/workspaces/[workspaceId]`: workspace home
- `/workspaces/[workspaceId]/repos/[repoId]`: repository code/overview
- `/notifications`: personal notifications
- `/logs`: activity/audit style feed
- `/settings`, `/settings/account`, `/settings/profile`, `/settings/developer`: account and developer settings

## Shared Layout Blocks
- `AppShell`: authenticated shell (header, sidebar, canvas)
- `PublicShell`: public-facing shell (header, search, CTA actions)
- `RepoHeader` and `RepoNav`: repository-local navigation and metadata summary

## Core UX Behaviors
- Route params accept canonical refs (`workspaceId`, `repoId`) and repo refs can resolve from id or slug at API level.
- API-backed pages show loading skeletons while requests are in flight.
- Toasts are used for success/error feedback on form actions.
- Search and jump menus resolve to workspace/repo targets when data is available.

## Main Action Areas
- Repositories: browse tree/blob/commits, create and edit files, branch operations.
- Issues: list, create, comment, and track issue status.
- Pull requests: create, review, diff view, and merge workflow.
- Settings: profile, account, PAT management, and developer controls.

## Empty/Error States
- List views provide explicit empty-state copy.
- Failed requests surface actionable toast messages.
- Destructive actions require explicit confirmation text.

---
Written by Krishnam Murarka (km@edilec.com)

