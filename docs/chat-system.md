# Chat System (Discussions v2)

This project now uses a chat-first discussion model under `/discussions/chat/*`.

## What Changed

- Replaced thread-style UI with a messaging layout.
- Added direct chats and group chats.
- Added message state lifecycle: `SENT -> DELIVERED -> SEEN -> PLAYED`.
- Added chat attachments metadata for `IMAGE`, `VIDEO`, `FILE`, and `AUDIO`.
- Added chat call sessions (`AUDIO` and `VIDEO`) from the chat header.
- Added call control signaling (`hold`, `resume`) so call pause/resume propagates to both peers.

## Data Model

Prisma models:
- `ChatConversation`
- `ChatConversationMember`
- `ChatMessage`
- `ChatAttachment`
- `ChatMessageReceipt`
- `ChatCallSession`

Old discussion tables are still present for backward compatibility, but the UI now uses only chat endpoints.

## API Surface

Base: `/discussions/chat`

- `GET /users/search?q=`
- `GET /conversations?q=&type=all|direct|group`
- `POST /conversations/direct`
- `POST /conversations/group`
- `PATCH /conversations/:conversationId`
- `POST /conversations/:conversationId/members`
- `DELETE /conversations/:conversationId/members/:userId`
- `GET /conversations/:conversationId/profile`
- `GET /conversations/:conversationId/messages`
- `POST /conversations/:conversationId/messages`
- `POST /conversations/:conversationId/read`
- `POST /messages/:messageId/played`
- `POST /conversations/:conversationId/calls`
- `GET /calls/incoming`
- `GET /calls/current`
- `POST /calls/:callId/accept`
- `POST /calls/:callId/signal`
- `GET /calls/:callId/events`
- `POST /calls/:callId/heartbeat`
- `POST /calls/:callId/end`

## Access Control

- Only authenticated users can use chat routes.
- Only conversation members can read or send messages.
- Only group admins can edit group metadata or add/remove other members.
- Direct chats are one-to-one using a stable pair key (`directKey`) to avoid duplicates.

## Attachments, Large Files, and Expiry

Current behavior:
- Messages store attachment metadata (kind, URL, optional filename/mime/size/expiry).
- File bytes are expected to be hosted by object storage/CDN and referenced by URL.

Recommended production behavior:
- Upload bytes to MinIO/S3 (or a CDN-backed object store).
- Use signed URLs for private media.
- Set `expiresAt` for temporary media URLs.
- Run a cleanup worker for expired media references if policy requires hard deletion.

## Offline and Delivery Semantics

- If recipient is offline, message remains stored in Postgres.
- On next fetch, recipient receipts are marked `DELIVERED`.
- Read action sets receipts to `SEEN` up to a chosen message.
- Audio messages can be marked `PLAYED` explicitly.

## Live Chat Behavior

Current implementation:
- Poll/fetch model via API reads.
- Consistent persisted state in DB.
- WebRTC media with API-based signaling (`offer`, `answer`, `ice`, `hold`, `resume`, `ended`).

Optional upgrade for stronger real-time:
- Add WebSocket/SSE fanout for instant new-message events.
- Keep DB as source of truth and use socket channel only as delivery transport.

## Caching Notes

- API should avoid long-lived cache for chat message endpoints.
- List/profile responses can use short TTL if needed.
- Object/media URLs should be cache-controlled by CDN/object storage policy.

## UI Behavior

`/discussions` now includes:
- Left pane: chat list + unread counts.
- Center pane: chat header, message feed, composer, call actions.
- Right pane: chat/group profile and member roles.

## Schema Apply

This feature is included in the tracked Prisma schema and migrations under:
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/`

Apply with:

```bash
pnpm --filter @uynis/db migrate:deploy
```
