# 03 - Save safe EVE history

## Goal

A completed or failed EVE turn leaves an idempotent event log and a structured, frontend-ready message projection in Supabase.

## Files

Create:
- `apps/web/lib/chat-sanitizer.ts`
- `apps/web/lib/chat-sanitizer.test.ts`
- `apps/web/app/api/chats/[chatId]/messages/pending/route.ts`
- `apps/web/app/api/chats/[chatId]/events/route.ts`
- `apps/web/app/api/chats/[chatId]/snapshot/route.ts`

Modify:
- `apps/web/hooks/use-chat-persistence.ts`
- `apps/web/lib/chat-client.ts`
- `apps/web/lib/chat-store.ts`
- `apps/web/package.json`

## Implementation notes

- Use `prepareSend` to store sanitized user input before returning the EVE payload. A failed pending-message write blocks that send.
- Queue `onEvent` writes in observed order. Insert by `event.meta.id`; retries and overlapping replay must not duplicate rows.
- Drop reasoning events and strip reasoning parts, artifact bytes, attachment bytes, data URLs, and base64 file payloads at the route boundary.
- Use `onFinish` to submit the ordered event snapshot, final session cursor, and sanitized EVE message projection. Reconcile `stream_index` from snapshot array positions and replace the thread's disposable `chat_messages` projection.
- Keep event ingestion and final reconciliation idempotent. A projection failure must not corrupt `chat_events`.

## Blocked by

- 02 - Bind a chat to its EVE session

## Done when

- One turn creates pending and completed message state plus its safe EVE events.
- Reposting the same event or final snapshot leaves one row per event ID and one ordered message projection.
- Queries confirm that reasoning events and file bytes are absent.

