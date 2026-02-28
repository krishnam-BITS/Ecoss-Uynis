# Developer Guide

## 1) Authentication for Automation

Generate PAT in portal:

- `Settings -> Developer -> Create token`

PAT scopes currently recognized by auth logic:

- `repo:read`
- `repo:write`
- `repo:admin`
- `platform:admin` (system admin only)
- `admin` (legacy alias treated as platform admin)

PAT value is shown once at creation time. After that, only token metadata is available in UI/API.

## 2) Git-over-HTTP Workflow

Canonical Git edge:

- `http://localhost:4001`

Clone:

```bash
git clone http://localhost:4001/<workspace>/<repo>.git
```

Push:

```bash
cd <repo>
git add .
git commit -m "feat: update"
git push origin <branch>
```

Auth prompt behavior:

- Username: any string
- Password: PAT

Rules:

- Public repo read may allow unauthenticated clone/fetch.
- Private repo read requires valid PAT/session auth.
- Write operations require write/admin scope.

## 3) API Automation

Use PAT in Bearer header:

```http
Authorization: Bearer <PAT_TOKEN>
```

Use API base URL:

- `http://localhost:4000`

## 4) Search Integration

Search requests route through API and OpenSearch-backed paths.
Supported search surfaces in UI include:

- Issues
- Pull requests
- Discussions (where enabled)
- Code

## 5) SDK Status

`packages/sdk` is available as an integration helper package for Node/TypeScript automation.
It wraps common API operations such as auth, repo management, imports, checks, and PAT operations.

## 6) CLI Status

A standalone CLI package is available:

- `packages/cli` (`uynis` command)

Recommended automation paths:

- Git client + PAT for source control operations
- `uynis` CLI for scripted metadata/workflow operations
- API + PAT for custom integrations
- Command examples: `docs/cli-usage.md`

## 7) Webhooks

- Configure webhooks in repository settings.
- Deliveries are processed by worker with retry/backoff.
- Signature header:
  - `x-uynis-signature-256: sha256=<digest>`

## 8) OTP Delivery Providers

Uynis OTP flows are split into two layers:

- `apps/api/src/lib/otp-service.ts`
  - generates secure 6-digit codes
  - hashes them with HMAC before storing challenge state
  - enforces expiry, verification attempt limits, and send lockouts
  - formats purpose-specific OTP message content
- `apps/api/src/lib/message-delivery.ts`
  - takes the normalized message payload from the OTP layer
  - optionally seals and signs webhook payloads
  - routes the delivery to `webhook`, `sendgrid`, `twilio`, or `auto`

### Key Handling

- `MESSAGE_DELIVERY_SHARED_KEY`
  - used by the Uynis API when sending webhook deliveries
  - seals payloads in transit and signs the webhook body
- `DELIVERY_EMULATOR_SHARED_KEY`
  - used by the emulator to verify and decrypt incoming webhook deliveries
  - must match `MESSAGE_DELIVERY_SHARED_KEY`
- `DELIVERY_EMULATOR_STORE_KEY`
  - used only by the emulator to encrypt stored local message copies
  - does not need to match the shared transport key

Recommended setup:

- use one strong random secret for `MESSAGE_DELIVERY_SHARED_KEY` and `DELIVERY_EMULATOR_SHARED_KEY`
- use a second strong random secret for `DELIVERY_EMULATOR_STORE_KEY`

### Emulator Only

Use this while no real external provider is connected.

```env
MESSAGE_DELIVERY_PROVIDER=webhook
MESSAGE_DELIVERY_WEBHOOK_URL=http://localhost:3011/api/messages
MESSAGE_DELIVERY_WEBHOOK_BEARER=
MESSAGE_DELIVERY_SHARED_KEY=dev-delivery-shared-key
```

Run the standalone emulator separately with matching inbound settings:

```bash
cd temp
npm install
npm run build
DELIVERY_EMULATOR_SHARED_KEY=dev-delivery-shared-key DELIVERY_EMULATOR_STORE_KEY=delivery-emulator-dev-key npm start
```

### SendGrid Only

Use this for email delivery only.

```env
MESSAGE_DELIVERY_PROVIDER=sendgrid
MESSAGE_DELIVERY_SENDGRID_API_KEY=<SENDGRID_API_KEY>
MESSAGE_DELIVERY_SENDGRID_FROM_EMAIL=no-reply@yourdomain.com
```

### Twilio Only

Use this for SMS delivery only.

```env
MESSAGE_DELIVERY_PROVIDER=twilio
MESSAGE_DELIVERY_TWILIO_ACCOUNT_SID=<TWILIO_ACCOUNT_SID>
MESSAGE_DELIVERY_TWILIO_AUTH_TOKEN=<TWILIO_AUTH_TOKEN>
MESSAGE_DELIVERY_TWILIO_FROM_PHONE=<TWILIO_PHONE>
```

### Mixed Auto Mode

Use this when you want channel-based routing:

- email -> SendGrid
- phone -> Twilio
- fallback -> webhook emulator if configured

```env
MESSAGE_DELIVERY_PROVIDER=auto
MESSAGE_DELIVERY_SENDGRID_API_KEY=<SENDGRID_API_KEY>
MESSAGE_DELIVERY_SENDGRID_FROM_EMAIL=no-reply@yourdomain.com
MESSAGE_DELIVERY_TWILIO_ACCOUNT_SID=<TWILIO_ACCOUNT_SID>
MESSAGE_DELIVERY_TWILIO_AUTH_TOKEN=<TWILIO_AUTH_TOKEN>
MESSAGE_DELIVERY_TWILIO_FROM_PHONE=<TWILIO_PHONE>
MESSAGE_DELIVERY_WEBHOOK_URL=http://localhost:3011/api/messages
MESSAGE_DELIVERY_SHARED_KEY=dev-delivery-shared-key
```

Notes:

- In `auto` mode, Uynis tries the channel-specific provider first.
- If that provider is not configured, it falls back to webhook delivery when available.
- Once real delivery providers are fully in use, the emulator is no longer required.
- If a provider cannot confirm delivery, Uynis keeps the account unverified and returns a user-facing delivery error instead of a generic 500.

### OTP Resend Limits

- the API allows the initial send plus up to `3` resends in a `1` hour window by default
- once that limit is reached, the next send is blocked server-side with `429`
- after the 1-hour lock window expires, sends are allowed again
- the send counter advances only after delivery is actually confirmed
- failed or unconfirmed delivery does not consume resend quota

---
Written by Krishnam Murarka (km@edilec.com)

