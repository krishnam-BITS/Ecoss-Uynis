# CLI and SDK Publishing Checklist

This page explains how to release CLI and SDK packages cleanly.

## 1) Package Preconditions

- CLI package: `packages/cli/package.json`
- SDK package: `packages/sdk/package.json`

Before publishing:

1. Set `private` to `false` for release.
2. Set final `name` and `version`.
3. Verify `files`, `bin` (CLI), `exports` (SDK), and `engines`.

## 2) Build and Smoke Checks

Run:

```bash
pnpm -C packages/sdk build
pnpm -C packages/cli smoke
pnpm cli --help
```

Optional auth behavior checks:

```bash
pnpm cli system health
pnpm cli workspace list
```

Both should fail with clear auth errors when no token is present.

## 3) NPM Authentication

Publisher (maintainer) logs in:

```bash
npm login
```

This is only for maintainers who publish packages, not end users.

## 4) Publish Commands

```bash
pnpm -C packages/sdk publish --access public
pnpm -C packages/cli publish --access public
```

## 5) End-User Install

CLI:

```bash
npm i -g @uynis/cli
uynis config profile set --name prod --api https://api.yourdomain.com
uynis auth login --identifier you@example.com
uynis workspace list
```

SDK:

```bash
npm i @uynis/sdk
```

## 6) Domain Defaults

- CLI resolves API URL in this order:
  1. `--api`
  2. `UYNIS_API_URL`
  3. profile config
  4. localhost fallback
- SDK resolves base URL in this order:
  1. constructor `baseUrl`
  2. `UYNIS_SDK_BASE_URL`
  3. `UYNIS_API_URL`
  4. localhost fallback

For production consumers, set one of:

- `UYNIS_API_URL=https://api.yourdomain.com`
- `UYNIS_SDK_BASE_URL=https://api.yourdomain.com`

## 7) Release Mode vs Monorepo Mode

- Monorepo/internal usage:
  - `pnpm cli ...`
  - local SDK imports through workspace tooling
- Public package usage:
  - globally installed `uynis` command
  - `npm i @uynis/sdk` in external projects

---
Written by Krishnam Murarka (km@edilec.com)

