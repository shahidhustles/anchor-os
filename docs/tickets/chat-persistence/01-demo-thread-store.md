# 01 - Persist demo threads

## Goal

Create, list, fetch, update, and archive the `demo` user's chat threads through server-only APIs.

## Files

Create:
- `apps/web/lib/chat-types.ts`
- `apps/web/lib/supabase-server.ts`
- `apps/web/lib/chat-store.ts`
- `apps/web/app/api/chats/route.ts`
- `apps/web/app/api/chats/[chatId]/route.ts`

Modify:
- `apps/web/package.json`
- `apps/web/.env.example`
- `bun.lock`

## Implementation notes

- Apply a Supabase MCP migration that adds `chat_threads.eve_stream_index bigint not null default 0`.
- Pin `@supabase/supabase-js`. Keep the secret key in the server module and out of all client bundles.
- Force `user_id = 'demo'` in the store. Parse request bodies as `unknown` and allow only title, model, session cursor, and archive mutations.
- Return active threads by `last_message_at`, then `created_at`, newest first.
- Preserve the user's unrelated artifact-preview changes in `apps/web/package.json` and `bun.lock`.

## Blocked by

None.

## Done when

- Creating a thread through `POST /api/chats` returns a UUID and inserts one `demo` row.
- `GET /api/chats` and `GET /api/chats/:chatId` return that row without exposing Supabase credentials.
- Archiving it removes it from the active list without deleting the row or touching its EVE session.

