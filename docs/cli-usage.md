# Uynis CLI Usage

The repository now includes a standalone CLI package:

- Package: `packages/cli`
- Entrypoint: `packages/cli/bin/uynis.mjs`

Run it with:

```bash
pnpm cli --help
```

Or directly:

```bash
node packages/cli/bin/uynis.mjs --help
```

CLI API URL resolution order:

1. `--api`
2. `UYNIS_API_URL`
3. saved profile API URL
4. default `http://localhost:4000`

## 1) Profiles and Token Storage

CLI stores local profile config at:

- `~/.uynis/config.json` (or `%USERPROFILE%\\.uynis\\config.json` on Windows)

Profile commands:

```bash
pnpm cli config profile set --name local --api http://localhost:4000
pnpm cli config profile use --name local
pnpm cli config profile list
pnpm cli config show
```

Login and save token to current profile:

```bash
pnpm cli auth login --identifier you@example.com --password "your-password"
```

If `--password` is not provided, CLI prompts for it interactively.

## 2) Authentication Commands

```bash
pnpm cli auth whoami
pnpm cli auth token set --token <PAT_TOKEN>
pnpm cli auth token clear
pnpm cli auth logout
```

## 3) System and Workspace Commands

Check API status:

```bash
pnpm cli system health
pnpm cli system ready
```

Note:
- CLI enforces token authentication for system commands as part of secure defaults.

List and create workspaces:

```bash
pnpm cli workspace list
pnpm cli workspace create --name "Platform Team" --slug platform-team
```

## 4) Repository Commands

Create repo:

```bash
pnpm cli repo create --workspace <workspaceId> --name demo --visibility PRIVATE
pnpm cli repo list --workspace <workspaceId>
```

Import local zip:

```bash
pnpm cli repo import-zip --workspace <workspaceId> --repo <repoId> --file .\\demo.zip --branch main --message "Initial import"
```

Import remote Git URL:

```bash
pnpm cli repo import-remote --workspace <workspaceId> --repo <repoId> --url https://github.com/example/demo.git
```

Async import job controls:

```bash
pnpm cli repo import-zip-async --workspace <workspaceId> --repo <repoId> --file .\\demo.zip --max-attempts 3
pnpm cli repo import-jobs --workspace <workspaceId> --repo <repoId>
pnpm cli repo import-job --workspace <workspaceId> --repo <repoId> --job <jobId>
pnpm cli repo import-cancel --workspace <workspaceId> --repo <repoId> --job <jobId>
```

## 5) Token Management

```bash
pnpm cli token create --name ci-token --scopes repo:read,repo:write --expires 30
pnpm cli token list
pnpm cli token revoke --token-id <tokenId>
```

## 6) File, Checks, and Webhooks

Create commit by uploading one file:

```bash
pnpm cli files upload --workspace <workspaceId> --repo <repoId> --path README.md --content "# Project" --message "Add readme"
```

Set commit check:

```bash
pnpm cli checks set --workspace <workspaceId> --repo <repoId> --sha <commitSha> --context ci/build --status SUCCESS --details "Build passed"
```

Rotate repository webhook secret:

```bash
pnpm cli webhook secret --workspace <workspaceId> --repo <repoId>
```

## 7) Admin Commands (System Admin + `platform:admin`)

These commands require:

- account configured as system admin
- PAT/session authorized for admin access (`platform:admin` for PAT path)

Examples:

```bash
pnpm cli admin health
pnpm cli admin users --q krish --limit 20
pnpm cli admin workspaces --q platform
pnpm cli admin repos --q api
pnpm cli admin pats --limit 50
pnpm cli admin revoke-pat --token-id <tokenId>
pnpm cli admin webhooks --active true
pnpm cli admin import-jobs --status FAILED --limit 30
pnpm cli admin security events --severity HIGH --limit 100
pnpm cli admin security anomalies --limit 50
pnpm cli admin security state --user-id <userId>
```

## 8) JSON Output for Automation

Use `--json` for machine-readable output:

```bash
pnpm cli --json token list
```

## 9) Notes

Use `pnpm cli ...` or `node packages/cli/bin/uynis.mjs ...` as the canonical interface.

---
Written by Krishnam Murarka (km@edilec.com)
