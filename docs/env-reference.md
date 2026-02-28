# Environment Reference

This document explains each environment variable used by Uynis.

## How to use

1. Copy `.env.example` to `.env`.
2. Update values for your mode:
   - Local host mode (apps run directly on your machine)
   - Docker mode (apps run in containers)
   - Production mode (server + domain)

## Database and Cache

- `DATABASE_URL`
  - Host-side PostgreSQL connection string.
  - Example: `postgresql://postgres:postgres@localhost:5433/uynis`
- `DATABASE_URL_DOCKER`
  - Docker-internal PostgreSQL URL (service DNS, not localhost).
  - Example: `postgresql://postgres:postgres@postgres:5432/uynis`
- `REDIS_URL`
  - Redis connection URL.
  - Local example: `redis://localhost:6379`
  - Docker example: `redis://redis:6379`
- `OPENSEARCH_URL`
  - OpenSearch endpoint for search indexing/query.
  - Local example: `http://localhost:9200`
  - Docker example: `http://opensearch:9200`
- `OPENSEARCH_INITIAL_ADMIN_PASSWORD`
  - Initial OpenSearch admin password for local/dev setup.

## Service Ports

- `API_PORT`
  - API listen port.
- `GIT_PORT`
  - Git storage service listen port.

## Security

- `JWT_SECRET`
  - JWT signing secret.
  - Must be long and random in production.
- `UPLOAD_TOKEN_SECRET`
  - Secret used for upload token signing/verification.
  - Must be long and random in production.
- `INTERNAL_RPC_TOKEN`
  - Shared secret for internal service-to-service RPC (especially API <-> git-storage).
  - Set a strong value in production.
- `OTP_HMAC_SECRET`
  - Secret used to HMAC-hash OTP codes before challenge state is stored.
  - Keep this long and random in production.

## Storage Paths and Object Store

- `REPO_STORAGE_PATH`
  - Filesystem path for Git repository storage.
  - Host mode example: `C:/.../uynis/data/repos`
  - Docker mode example: `/var/lib/uynis/repos`
- `REQUIRE_REPO_STORAGE_PATH`
  - If `true`, API refuses startup when `REPO_STORAGE_PATH` is empty.
- `UPLOADS_PATH`
  - Optional local filesystem upload path fallback.
  - Host mode example: `C:/.../uynis/data/uploads`
- `S3_ENDPOINT`
  - S3-compatible endpoint (MinIO or cloud S3).
- `S3_ACCESS_KEY`
  - S3 access key.
- `S3_SECRET_KEY`
  - S3 secret key.
- `S3_REGION`
  - S3 region string.
- `S3_BUCKET_UPLOADS`
  - Bucket used for uploads/attachments.
- `UPLOADS_LEGACY_FALLBACK`
  - If `true`, enables legacy/local fallback behavior for some upload paths.

## Import Worker

- `IMPORT_WORKER_ENABLED`
  - Enables import/background worker loop in that process.
- `IMPORT_JOB_POLL_MS`
  - Poll interval for pending jobs.
- `IMPORT_JOB_STALE_MS`
  - Time to consider a running job stale.
- `IMPORT_JOB_RETRY_BASE_MS`
  - Base retry backoff for failed jobs.
- `IMPORT_UPLOAD_MAX_BYTES`
  - Max archive size for import uploads.

## Upload and Request Limits

- `UPLOAD_BODY_LIMIT`
  - API multipart/request body max bytes.
- `ATTACHMENT_MAX_BYTES`
  - Max attachment size.

## Public URLs

- `API_PUBLIC_URL`
  - External API URL used by clients/integrations.
- `NEXT_PUBLIC_API_URL`
  - API URL used by browser frontend.
- `NEXT_PUBLIC_GIT_URL`
  - Git HTTP URL used by frontend/help flows.
- `GIT_STORAGE_RPC_URL`
  - Internal URL API uses to call git-storage service.
  - Docker example: `http://git-storage:4001`
- `UYNIS_API_URL`
  - Default API URL fallback for CLI and SDK clients.
  - Useful when `--api`/`baseUrl` is not provided.
- `UYNIS_SDK_BASE_URL`
  - SDK-specific API URL fallback (takes precedence over `UYNIS_API_URL` in SDK).

## Admin and Governance

- `ADMIN_EMAILS`
  - Comma-separated system admin emails.
- `ADMIN_USER_IDS`
  - Comma-separated system admin user IDs.
- `ALLOW_DEV_ADMIN_FALLBACK`
  - Dev-only fallback for admin capability if true.
  - Keep `false` in production.

## OTP and Message Delivery

- `OTP_TTL_MS`
  - OTP validity window in milliseconds.
- `OTP_MAX_ATTEMPTS`
  - Max failed verification attempts before the OTP challenge is discarded.
- `OTP_MAX_SENDS_PER_WINDOW`
  - Max OTP sends per scope inside one send window.
  - Default behavior is initial send + three resends.
  - The counter advances only when delivery is actually confirmed.
- `OTP_SEND_LOCK_WINDOW_MS`
  - Lock duration after the send cap is exceeded.
  - Default is `3600000` (1 hour).
- `OTP_SENDER_EMAIL`
  - Sender address used for email OTP messages.
- `OTP_SENDER_PHONE`
  - Sender label or number used for phone OTP messages.

- `MESSAGE_DELIVERY_PROVIDER`
  - Delivery backend selection.
  - Supported: `none`, `webhook`, `sendgrid`, `twilio`, `auto`.
- `MESSAGE_DELIVERY_WEBHOOK_URL`
  - Outbound webhook URL for the emulator or another custom delivery receiver.
- `MESSAGE_DELIVERY_WEBHOOK_BEARER`
  - Optional bearer token added to webhook requests.
- `MESSAGE_DELIVERY_SHARED_KEY`
  - Shared transport key used to seal webhook payloads and sign the request body.
  - Must match `DELIVERY_EMULATOR_SHARED_KEY` when using the emulator.
- `MESSAGE_DELIVERY_SENDGRID_API_KEY`
  - SendGrid API key for email delivery.
- `MESSAGE_DELIVERY_SENDGRID_FROM_EMAIL`
  - Sender email address used with SendGrid.
- `MESSAGE_DELIVERY_TWILIO_ACCOUNT_SID`
  - Twilio account SID for SMS delivery.
- `MESSAGE_DELIVERY_TWILIO_AUTH_TOKEN`
  - Twilio auth token for SMS delivery.
- `MESSAGE_DELIVERY_TWILIO_FROM_PHONE`
  - Twilio sender phone number.

## Delivery Emulator (Optional)

These belong to the standalone emulator under `temp/`, not the main Uynis app.

- `DELIVERY_EMULATOR_PORT`
  - Emulator HTTP port.
- `DELIVERY_EMULATOR_DATA_PATH`
  - Local encrypted message store path.
  - Default path is `temp/data/messages.json` when started from `temp/`.
- `DELIVERY_EMULATOR_BEARER`
  - Optional bearer token required by the emulator webhook endpoint.
- `DELIVERY_EMULATOR_SHARED_KEY`
  - Inbound transport key used by the emulator to verify signatures and decrypt sealed payloads.
  - Must match `MESSAGE_DELIVERY_SHARED_KEY`.
  - Read from the emulator process environment at startup.
- `DELIVERY_EMULATOR_STORE_KEY`
  - Local-at-rest encryption key for the emulator message store.
  - Does not need to match the shared key.
  - Read from the emulator process environment at startup.

## Quick Profiles

### Host mode

- Use `DATABASE_URL` with `localhost`.
- Use absolute host paths for `REPO_STORAGE_PATH` and `UPLOADS_PATH`.
- Use `NEXT_PUBLIC_*` pointing to host ports.

### Docker mode

- Use service DNS names (`postgres`, `redis`, `opensearch`, `git-storage`) for container-to-container connections.
- Keep repo path in container path (`/var/lib/uynis/repos`) and map volume.

### Production mode

- Replace all secrets with strong random values.
- Use production DB/Redis/S3/OpenSearch endpoints.
- Set public URLs to domain-based endpoints.
- Disable dev fallbacks.

---
Written by Krishnam Murarka (km@edilec.com)
