# Temp Delivery Emulator

This app is intentionally separate from the main Uynis product.

## Purpose

- receive OTP delivery payloads from Uynis over a webhook
- store those payloads locally in encrypted form
- render a simple mail view and phone-message view so OTP flows can be tested

It is only an emulator for development and temporary testing.

## Why it exists

While no real external delivery provider is connected, Uynis still needs a way to:

- generate real OTPs
- send them through the same provider contract it will use later
- let you inspect the delivered message and verify the flow

This emulator fills that gap.

## When you will not need it

If you connect SendGrid, Twilio, or another real delivery provider, this emulator can be removed.

Deleting `temp/` does not break the Uynis application structure.
It only means deliveries sent to the emulator endpoint will stop working until `MESSAGE_DELIVERY_*` env settings are pointed at a real provider.

If the emulator is down, the main Uynis app should keep running.
You simply will not be able to inspect delivered messages in the emulator until it is started again.

## Emulator env vars

These env vars belong to the emulator itself, not the main Uynis app:

- `DELIVERY_EMULATOR_PORT`
- `DELIVERY_EMULATOR_DATA_PATH`
- `DELIVERY_EMULATOR_BEARER`
- `DELIVERY_EMULATOR_SHARED_KEY`
- `DELIVERY_EMULATOR_STORE_KEY`

The main Uynis app still uses `MESSAGE_DELIVERY_*` env vars to decide where to send messages.
The emulator now loads `temp/.env` first, then `temp/.env.local`, and finally falls back to the shell environment. Shell environment values still win if already set.

### Key roles

- `DELIVERY_EMULATOR_SHARED_KEY`
  - used for transport security
  - verifies the webhook signature
  - decrypts sealed payloads sent by the API
  - must match Uynis `MESSAGE_DELIVERY_SHARED_KEY`
- `DELIVERY_EMULATOR_STORE_KEY`
  - used only for local storage encryption inside the emulator
  - protects saved messages in `temp/data/messages.json`
  - can be different from the shared transport key

## Current pieces

- `server.mjs`
  - receives webhook deliveries at `/api/messages`
  - verifies the shared-key signature when configured
  - decrypts sealed payloads
  - stores encrypted copies locally
  - serves the built UI
- `src/`
  - standalone React/Vite frontend for mail and phone previews

## Run locally

```bash
cd temp
npm install
npm run build
cp .env.example .env
npm start
```

Then open:

```text
http://localhost:3011
```

If you want to run it with custom emulator settings:

```bash
DELIVERY_EMULATOR_PORT=3011 DELIVERY_EMULATOR_SHARED_KEY=dev-key npm start
```

You can also keep machine-specific overrides in `temp/.env.local`.
