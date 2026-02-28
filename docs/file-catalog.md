# File Catalog

This catalog lists tracked repository files and their primary purpose.

## Directory Tree
- `.`
- `apps\api`
- `apps\api\scripts`
- `apps\api\src`
- `apps\api\src\lib`
- `apps\api\src\routes`
- `temp`
- `temp\data`
- `temp\public`
- `temp\src`
- `apps\git`
- `apps\git\src`
- `apps\git\src\lib`
- `apps\web`
- `apps\web\app`
- `apps\web\app\activity`
- `apps\web\app\admin`
- `apps\web\app\dashboard`
- `apps\web\app\developers`
- `apps\web\app\discussions`
- `apps\web\app\docs`
- `apps\web\app\forgot-id`
- `apps\web\app\forgot-password`
- `apps\web\app\help`
- `apps\web\app\home`
- `apps\web\app\invites`
- `apps\web\app\issues`
- `apps\web\app\login`
- `apps\web\app\logs`
- `apps\web\app\notifications`
- `apps\web\app\notifications\invites`
- `apps\web\app\notifications\manage`
- `apps\web\app\notifications\mentions`
- `apps\web\app\notifications\reviews`
- `apps\web\app\notifications\system`
- `apps\web\app\private`
- `apps\web\app\private\dashboard`
- `apps\web\app\private\recover`
- `apps\web\app\projects`
- `apps\web\app\pulls`
- `apps\web\app\repositories`
- `apps\web\app\search`
- `apps\web\app\settings`
- `apps\web\app\settings\account`
- `apps\web\app\settings\developer`
- `apps\web\app\settings\notifications`
- `apps\web\app\settings\profile`
- `apps\web\app\settings\security`
- `apps\web\app\signup`
- `apps\web\app\styles`
- `apps\web\app\tasks`
- `apps\web\app\terms`
- `apps\web\app\workspace`
- `apps\web\app\workspaces`
- `apps\web\components`
- `apps\web\components\icons`
- `apps\web\components\portal`
- `apps\web\components\repo`
- `apps\web\components\repo-detail`
- `apps\web\lib`
- `apps\web\scripts`
- `apps\web\src\components\settings`
- `apps\web\src\components\ui`
- `docs`
- `infra`
- `openapi`
- `packages\db`
- `packages\db\prisma`
- `packages\db\prisma\migrations`
- `packages\db\prisma\migrations\20260301013000_init`
- `packages\db\src`
- `packages\sdk`
- `packages\sdk\src`
- `packages\shared`
- `packages\shared\src`
- `packages\ui`
- `scripts`

## File Inventory

| File | Purpose |
| --- | --- |
| `.editorconfig` | Repository file. |
| `.env.example` | Environment template for local and deployment configuration. |
| `.gitignore` | Repository file. |
| `.nvmrc` | Repository file. |
| `apps/api/.eslintrc.cjs` | Source code or runtime script file. |
| `apps/api/package.json` | JSON configuration or metadata file. |
| `apps/api/scripts/node-version-check.mjs` | Source code or runtime script file. |
| `apps/api/scripts/prebuild.mjs` | Source code or runtime script file. |
| `apps/api/scripts/preflight.mjs` | Source code or runtime script file. |
| `apps/api/scripts/seed-demo.ts` | Source code or runtime script file. |
| `apps/api/scripts/seed-discussions.ts` | Source code or runtime script file. |
| `apps/api/scripts/validate-git-receive.mjs` | Source code or runtime script file. |
| `apps/api/src/index.ts` | Source code or runtime script file. |
| `apps/api/src/lib/auth.ts` | API shared helper module. |
| `apps/api/src/lib/automation-tokens.ts` | API shared helper module. |
| `apps/api/src/lib/branch-rules.ts` | API shared helper module. |
| `apps/api/src/lib/codeowners.ts` | API shared helper module. |
| `apps/api/src/lib/code-search.ts` | API shared helper module. |
| `apps/api/src/lib/email.ts` | API shared helper module. |
| `apps/api/src/lib/git.ts` | API shared helper module. |
| `apps/api/src/lib/git-engine.ts` | API shared helper module. |
| `apps/api/src/lib/git-info.ts` | API shared helper module. |
| `apps/api/src/lib/git-storage-client.ts` | API shared helper module. |
| `apps/api/src/lib/import-jobs.ts` | API shared helper module. |
| `apps/api/src/lib/import-worker.ts` | API shared helper module. |
| `apps/api/src/lib/message-delivery.ts` | Generic outbound message delivery provider used by OTP and future external delivery integrations. |
| `apps/api/src/lib/metrics.ts` | API shared helper module. |
| `apps/api/src/lib/notifications.ts` | API shared helper module. |
| `apps/api/src/lib/object-store.ts` | API shared helper module. |
| `apps/api/src/lib/otp-service.ts` | OTP generation, challenge verification, and OTP message composition helper. |
| `apps/api/src/lib/opensearch.ts` | API shared helper module. |
| `apps/api/src/lib/password.ts` | API shared helper module. |
| `apps/api/src/lib/pat-auth.ts` | API shared helper module. |
| `apps/api/src/lib/pats.ts` | API shared helper module. |
| `apps/api/src/lib/permissions.ts` | API shared helper module. |
| `apps/api/src/lib/prisma.ts` | API shared helper module. |
| `apps/api/src/lib/rate-limit.ts` | API shared helper module. |
| `apps/api/src/lib/readiness.ts` | API shared helper module. |
| `apps/api/src/lib/redis.ts` | API shared helper module. |
| `apps/api/src/lib/repo-access.ts` | API shared helper module. |
| `apps/api/src/lib/repo-labels.ts` | API shared helper module. |
| `apps/api/src/lib/repo-webhooks.ts` | API shared helper module. |
| `apps/api/src/lib/resource-validation.ts` | API shared helper module. |
| `apps/api/src/lib/security.ts` | API shared helper module. |
| `apps/api/src/lib/sessions.ts` | API shared helper module. |
| `apps/api/src/lib/slug.ts` | API shared helper module. |
| `apps/api/src/lib/task-workflows.ts` | API shared helper module. |
| `apps/api/src/lib/uploads.ts` | API shared helper module. |
| `apps/api/src/lib/upload-tokens.ts` | API shared helper module. |
| `apps/api/src/lib/user-account.ts` | API shared helper module. |
| `apps/api/src/lib/username.ts` | API shared helper module. |
| `apps/api/src/lib/webhook-signature.ts` | API shared helper module. |
| `apps/api/src/lib/workspace-invites.ts` | API shared helper module. |
| `apps/api/src/routes/admin.ts` | Fastify API route handler. |
| `apps/api/src/routes/auth.ts` | Fastify API route handler. |
| `apps/api/src/routes/discussions.ts` | Fastify API route handler. |
| `apps/api/src/routes/git-http.ts` | Fastify API route handler. |
| `apps/api/src/routes/hooks.ts` | Fastify API route handler. |
| `apps/api/src/routes/issues.ts` | Fastify API route handler. |
| `apps/api/src/routes/me.ts` | Fastify API route handler. |
| `apps/api/src/routes/notifications.ts` | Fastify API route handler. |
| `apps/api/src/routes/pulls.ts` | Fastify API route handler. |
| `apps/api/src/routes/search.ts` | Fastify API route handler. |
| `apps/api/src/routes/tasks.ts` | Fastify API route handler. |
| `apps/api/src/routes/uploads.ts` | Fastify API route handler. |
| `apps/api/src/routes/users.ts` | Fastify API route handler. |
| `apps/api/src/routes/workspaces.ts` | Fastify API route handler. |
| `apps/api/src/types.ts` | Source code or runtime script file. |
| `apps/api/src/worker.ts` | Background worker entrypoint. |
| `apps/api/tsconfig.build.json` | JSON configuration or metadata file. |
| `apps/api/tsconfig.json` | JSON configuration or metadata file. |
| `apps/git/package.json` | JSON configuration or metadata file. |
| `apps/git/src/index.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/git-read-engine.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/internal-rpc-auth.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/pat-auth.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/rate-limit.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/redis.ts` | Git HTTP edge service logic. |
| `apps/git/src/lib/repo-webhooks.ts` | Git HTTP edge service logic. |
| `apps/git/tsconfig.json` | JSON configuration or metadata file. |
| `apps/web/.eslintrc.json` | JSON configuration or metadata file. |
| `apps/web/app/activity/page.tsx` | Next.js web application source file. |
| `apps/web/app/admin/page.tsx` | Next.js web application source file. |
| `apps/web/app/dashboard/page.tsx` | Next.js web application source file. |
| `apps/web/app/developers/page.tsx` | Next.js web application source file. |
| `apps/web/app/discussions/page.tsx` | Next.js web application source file. |
| `apps/web/app/docs/page.tsx` | Next.js web application source file. |
| `apps/web/app/error.tsx` | Next.js web application source file. |
| `apps/web/app/forgot-id/page.tsx` | Next.js web application source file. |
| `apps/web/app/forgot-password/page.tsx` | Next.js web application source file. |
| `apps/web/app/globals.css` | Repository file. |
| `apps/web/app/help/page.tsx` | Next.js web application source file. |
| `apps/web/app/home/page.tsx` | Next.js web application source file. |
| `apps/web/app/invites/page.tsx` | Next.js web application source file. |
| `apps/web/app/issues/page.tsx` | Next.js web application source file. |
| `apps/web/app/layout.tsx` | Next.js web application source file. |
| `apps/web/app/loading.tsx` | Next.js web application source file. |
| `apps/web/app/login/page.tsx` | Next.js web application source file. |
| `apps/web/app/logs/page.tsx` | Next.js web application source file. |
| `apps/web/app/not-found.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/invites/page.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/manage/page.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/mentions/page.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/page.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/reviews/page.tsx` | Next.js web application source file. |
| `apps/web/app/notifications/system/page.tsx` | Next.js web application source file. |
| `apps/web/app/page.tsx` | Next.js web application source file. |
| `apps/web/app/private/dashboard/page.tsx` | Next.js web application source file. |
| `apps/web/app/private/page.tsx` | Next.js web application source file. |
| `apps/web/app/private/recover/page.tsx` | Next.js web application source file. |
| `apps/web/app/projects/page.tsx` | Next.js web application source file. |
| `apps/web/app/pulls/page.tsx` | Next.js web application source file. |
| `apps/web/app/repositories/page.tsx` | Next.js web application source file. |
| `apps/web/app/search/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/account/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/developer/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/layout.tsx` | Next.js web application source file. |
| `apps/web/app/settings/notifications/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/profile/page.tsx` | Next.js web application source file. |
| `apps/web/app/settings/security/page.tsx` | Next.js web application source file. |
| `apps/web/app/signup/page.tsx` | Next.js web application source file. |
| `apps/web/app/styles/auth.css` | Global or route-level stylesheet for web UI. |
| `apps/web/app/styles/portal.css` | Global or route-level stylesheet for web UI. |
| `apps/web/app/styles/public.css` | Global or route-level stylesheet for web UI. |
| `apps/web/app/tasks/page.tsx` | Next.js web application source file. |
| `apps/web/app/terms/page.tsx` | Next.js web application source file. |
| `apps/web/app/workspace/page.tsx` | Next.js web application source file. |
| `apps/web/app/workspaces/page.tsx` | Next.js web application source file. |
| `apps/web/components/AppShell.tsx` | Next.js web application source file. |
| `apps/web/components/AuthSplitLayout.tsx` | Next.js web application source file. |
| `apps/web/components/icons/ChevronDownIcon.tsx` | Next.js web application source file. |
| `apps/web/components/LandingPage.tsx` | Next.js web application source file. |
| `apps/web/components/NotificationPreferences.tsx` | Next.js web application source file. |
| `apps/web/components/NotificationsCenter.tsx` | Next.js web application source file. |
| `apps/web/components/NotificationsTabs.tsx` | Next.js web application source file. |
| `apps/web/components/PermissionGate.tsx` | Next.js web application source file. |
| `apps/web/components/portal.ts` | Next.js web application source file. |
| `apps/web/components/portal/index.ts` | Next.js web application source file. |
| `apps/web/components/portal/PortalAction.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalBadge.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalCard.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalEmptyState.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalList.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalModal.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalPage.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalRow.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalSkeleton.tsx` | Next.js web application source file. |
| `apps/web/components/portal/PortalToolbar.tsx` | Next.js web application source file. |
| `apps/web/components/PortalHome.tsx` | Next.js web application source file. |
| `apps/web/components/PortalToast.tsx` | Next.js web application source file. |
| `apps/web/components/PublicShell.tsx` | Next.js web application source file. |
| `apps/web/components/repo/CardStack.tsx` | Next.js web application source file. |
| `apps/web/components/repo/DataTable.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/CodeEditor.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/CommentComposer.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/DetailHeader.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/index.ts` | Next.js web application source file. |
| `apps/web/components/repo-detail/MarkdownViewer.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/RichMarkdown.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/SidebarCard.tsx` | Next.js web application source file. |
| `apps/web/components/repo-detail/TimelineItem.tsx` | Next.js web application source file. |
| `apps/web/components/RepoHeader.tsx` | Next.js web application source file. |
| `apps/web/components/RepoListRow.tsx` | Next.js web application source file. |
| `apps/web/components/RepoNav.tsx` | Next.js web application source file. |
| `apps/web/components/RepoSettingsNav.tsx` | Next.js web application source file. |
| `apps/web/components/SettingsNav.tsx` | Next.js web application source file. |
| `apps/web/components/UynisLogo.tsx` | Next.js web application source file. |
| `apps/web/components/WorkspaceHeader.tsx` | Next.js web application source file. |
| `apps/web/components/WorkspaceNav.tsx` | Next.js web application source file. |
| `apps/web/components/WorkspaceSwitcher.tsx` | Next.js web application source file. |
| `apps/web/lib/api.ts` | Next.js web application source file. |
| `apps/web/lib/attachments.tsx` | Next.js web application source file. |
| `apps/web/lib/auth.ts` | Next.js web application source file. |
| `apps/web/lib/auth-redirect.ts` | Next.js web application source file. |
| `apps/web/lib/bip39.ts` | Next.js web application source file. |
| `apps/web/lib/config.ts` | Next.js web application source file. |
| `apps/web/lib/media.ts` | Next.js web application source file. |
| `apps/web/lib/mentions.ts` | Next.js web application source file. |
| `apps/web/lib/public-navigation.ts` | Next.js web application source file. |
| `apps/web/lib/resource-validation.ts` | Next.js web application source file. |
| `apps/web/lib/tasks.ts` | Next.js web application source file. |
| `apps/web/lib/theme.ts` | Next.js web application source file. |
| `apps/web/lib/workspace.ts` | Next.js web application source file. |
| `apps/web/middleware.ts` | Next.js web application source file. |
| `apps/web/next.config.js` | Source code or runtime script file. |
| `apps/web/next-env.d.ts` | Next.js web application source file. |
| `apps/web/package.json` | JSON configuration or metadata file. |
| `apps/web/scripts/check-utf8.mjs` | Source code or runtime script file. |
| `apps/web/scripts/predev-check.mjs` | Source code or runtime script file. |
| `apps/web/src/components/settings/ChangePasswordModal.tsx` | Next.js web application source file. |
| `apps/web/src/components/settings/PatManagement.tsx` | Next.js web application source file. |
| `apps/web/src/components/settings/RepoSettingsTabs.tsx` | Next.js web application source file. |
| `apps/web/src/components/settings/WebhookDeliveryLog.tsx` | Next.js web application source file. |
| `apps/web/src/components/settings/WebhookList.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Alert.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Badge.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Button.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Card.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Dropdown.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/EmptyState.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/index.ts` | Next.js web application source file. |
| `apps/web/src/components/ui/InlineFormRow.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Modal.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/SectionHeader.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Skeleton.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Table.tsx` | Next.js web application source file. |
| `apps/web/src/components/ui/Tabs.tsx` | Next.js web application source file. |
| `apps/web/tsconfig.json` | JSON configuration or metadata file. |
| `docs/admin-guide.md` | Project documentation page. |
| `docs/architecture-overview.md` | Project documentation page. |
| `docs/chat-system.md` | Project documentation page. |
| `docs/cli-usage.md` | Project documentation page. |
| `docs/cli-sdk-publishing.md` | Project documentation page. |
| `docs/compose-reference.md` | Project documentation page. |
| `docs/deployment.md` | Project documentation page. |
| `docs/developer-guide.md` | Project documentation page. |
| `docs/end-to-end-flow.md` | Project documentation page. |
| `docs/env-reference.md` | Project documentation page. |
| `docs/file-catalog.md` | Project documentation page. |
| `docs/getting-started.md` | Project documentation page. |
| `docs/README.md` | Project documentation page. |
| `docs/performance-guide.md` | Project documentation page. |
| `docs/production-rollout.md` | Project documentation page. |
| `docs/public-workspace-access-model.md` | Project documentation page. |
| `docs/repo-structure.md` | Project documentation page. |
| `docs/sdk-usage.md` | Project documentation page. |
| `docs/system-operations.md` | Project documentation page. |
| `docs/ui-map.md` | Project documentation page. |
| `docs/user-guide.md` | Project documentation page. |
| `infra/docker-compose.internal.yml` | Infrastructure or deployment configuration. |
| `infra/docker-compose.yml` | Infrastructure or deployment configuration. |
| `openapi/uynis.yaml` | YAML configuration file. |
| `package.json` | JSON configuration or metadata file. |
| `packages/db/package.json` | JSON configuration or metadata file. |
| `packages/db/prisma/migrations/20260301013000_init/migration.sql` | SQL script or migration asset. |
| `packages/db/prisma/migrations/migration_lock.toml` | Repository file. |
| `packages/db/prisma/schema.prisma` | Repository file. |
| `packages/db/src/client.ts` | Database package source module. |
| `packages/db/src/index.ts` | Database package source module. |
| `packages/db/src/permissions.ts` | Database package source module. |
| `packages/db/tsconfig.build.json` | JSON configuration or metadata file. |
| `packages/db/tsconfig.json` | JSON configuration or metadata file. |
| `packages/cli/bin/uynis.mjs` | Standalone CLI entrypoint. |
| `packages/cli/package.json` | JSON configuration or metadata file. |
| `packages/cli/README.md` | Package documentation and usage notes. |
| `packages/cli/src/config.mjs` | CLI profile configuration helper. |
| `packages/sdk/package.json` | JSON configuration or metadata file. |
| `packages/sdk/README.md` | Package documentation and usage notes. |
| `packages/sdk/src/index.ts` | SDK source module. |
| `packages/sdk/tsconfig.build.json` | JSON configuration or metadata file. |
| `packages/sdk/tsconfig.json` | JSON configuration or metadata file. |
| `packages/shared/package.json` | JSON configuration or metadata file. |
| `packages/shared/src/index.ts` | Source code or runtime script file. |
| `packages/shared/tsconfig.json` | JSON configuration or metadata file. |
| `packages/ui/package.json` | JSON configuration or metadata file. |
| `packages/ui/tsconfig.json` | JSON configuration or metadata file. |
| `pnpm-lock.yaml` | YAML configuration file. |
| `pnpm-workspace.yaml` | YAML configuration file. |
| `README.md` | Primary project entrypoint and documentation index. |
| `scripts/check-db.mjs` | Maintenance or operational script. |
| `tsconfig.json` | JSON configuration or metadata file. |
| `temp/index.html` | Standalone Vite entry document for the OTP emulator UI. |
| `temp/package-lock.json` | Local dependency lockfile for the standalone OTP delivery emulator. |
| `temp/package.json` | Separate package manifest for the OTP delivery emulator. |
| `temp/README.md` | Usage notes for the temporary OTP delivery emulator. |
| `temp/server.mjs` | Standalone local delivery emulator server and webhook receiver. |
| `temp/src/App.jsx` | React emulator UI for mail and phone delivery previews. |
| `temp/src/main.jsx` | React emulator client bootstrap. |
| `temp/src/styles.css` | Standalone emulator UI styles. |
| `temp/vite.config.js` | Separate Vite build configuration for the emulator. |
| `turbo.json` | JSON configuration or metadata file. |

---
Written by Krishnam Murarka (km@edilec.com)
