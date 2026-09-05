# Durable chat persistence

## Goal

Persist Anchor OS chats for the fixed `demo` user. After a reload, the sidebar shows the same chats, opening one restores its transcript, and the next message continues the original EVE session with the same sandbox workspace.

This extends the Task 1 artifact flow. Supabase stores chat metadata and safe chat history. EVE remains responsible for model context and the session workspace. Artifact files stay out of Supabase.

## User flow

1. Anchor OS loads the active `demo` threads from Supabase in recent-activity order.
2. If no thread exists, or the user clicks New chat, Anchor OS creates a Supabase thread before allowing a message to send.
3. Before each EVE send, Anchor OS stores the sanitized user message as pending.
4. The first accepted EVE turn returns a session cursor. Anchor OS immediately binds its `sessionId` and `streamIndex` to the Supabase thread.
5. While EVE streams, Anchor OS stores safe authoritative events by `event.meta.id`. At the turn boundary it stores the final cursor and repairs the message projection from the completed EVE snapshot.
6. Reloading the app fetches the saved thread, event history, message projection, and EVE cursor. The saved events render first, then `useEveAgentRuntime` resumes the same durable session and catches up any missing events.
7. The user can continue chatting. EVE reuses that session's sandbox, so existing workspace files remain available and the artifact panel still resolves them by session ID.
8. Deleting a chat archives it in Supabase and removes it from the active sidebar without resetting EVE or deleting its sandbox.

## Requirements

- Use `demo` as the only application user. The browser must call same-origin Next.js route handlers. Supabase credentials remain server-only.
- Keep the current one-mounted-runtime-per-chat behavior so a running turn can continue while another chat is selected.
- Create the Supabase thread before its first send. Disable sending while that creation is pending or has failed.
- Use EVE's installed persistence contract:
  - `prepareSend` stores the pending user input before dispatch.
  - `onSessionChange` stores `sessionId` and `streamIndex`.
  - `onEvent` stores authoritative stream events as they arrive.
  - `onFinish` stores the final cursor and reconciles the message projection.
- Treat `event.meta.id` as the event idempotency key. Preserve event order with EVE stream indexes when a final snapshot provides them, otherwise use database ingestion order until reconciliation.
- Store user-visible structured content, including text, tool calls, tool results, errors, and artifact path references.
- Do not store `reasoning.appended`, `reasoning.completed`, hidden reasoning content, artifact bytes, attachment bytes, data URLs, or base64 file payloads. A sanitizer must validate every event and message at the server boundary before writing JSONB.
- Use `chat_events` as the recoverable event history. Use `chat_messages` as the read-optimized, sanitized projection returned to the frontend. A failed projection write must remain repairable from stored events or EVE replay.
- Reopening a thread with an EVE session must pass saved events through `initialEvents`, pass `{ sessionId, streamIndex }` through `initialSession`, and set `resume: true`.
- While a runtime is resuming, show its saved history but block new messages and HITL responses.
- If an EVE session cannot resume, keep the Supabase transcript visible, disable the composer, and show a clear workspace-unavailable error. Do not silently create a replacement session.
- Persist title, model selection, last-message time, session cursor, and archive state. Keep `sandbox_id` nullable and diagnostic only. The client must never use it as the continuation key.
- Disable EVE's default 30-day session deadline for this prototype with `limits.sessionTimeoutMs: false`.
- Preserve the existing artifact cache and workspace behavior. Chat persistence must not write artifact files into Supabase or move them out of the EVE sandbox.
- Surface load and save failures in the UI. Retry idempotent event and snapshot writes without duplicating rows.

## Implementation decisions

- The live Supabase project already has RLS-enabled `app_users`, `chat_threads`, `chat_events`, and `chat_messages` tables from migration `create_demo_chat_persistence`. Browser roles have no table access. `service_role` is the only data role used by the app.
- Add an `eve_stream_index bigint not null default 0` column to `chat_threads` through a Supabase MCP migration. Keep the existing unique nullable `eve_session_id` and the existing event and message constraints.
- Add pinned `@supabase/supabase-js` to `apps/web`. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-only environment variables. Accept the legacy service-role variable only if the project already supplies it.
- Put server client creation and database operations behind `apps/web/lib/supabase-server.ts` and `apps/web/lib/chat-store.ts`. Parse external JSON as `unknown` at route boundaries.
- Add same-origin handlers under `apps/web/app/api/chats/` for list/create, fetch/update/archive, event ingestion, pending user messages, and final snapshot reconciliation. Every operation forces `user_id = 'demo'`; no request may choose a user ID.
- Keep the existing sidebar and `ChatPane` composition in `apps/web/app/page.tsx`. Do not replace the EVE runtime with Assistant Cloud or a second chat runtime.
- Put browser fetch helpers in `apps/web/lib/chat-client.ts`, shared validated shapes in `apps/web/lib/chat-types.ts`, and the EVE callback queue in `apps/web/hooks/use-chat-persistence.ts`.
- Key each mounted `ChatPane` by the application thread UUID. EVE options are fixed when the hook creates its store, so a restored pane receives its saved session and events at mount time.
- The final snapshot endpoint may replace the `chat_messages` projection for one thread. `chat_events` remains the recovery source if that replacement is interrupted.
- Keep the remote database migration as the deployed source for this hackathon slice. Creating a full local Supabase project and backfilling old in-memory chats are separate work.

## Demo / acceptance

- [ ] Start with an empty database, open Anchor OS, and see one usable New chat owned by `demo`.
- [ ] Send a message and confirm its thread exists before EVE dispatch, then gains a non-null `eve_session_id` and current `eve_stream_index`.
- [ ] Complete a turn and confirm Supabase contains deduplicated safe events and a structured message projection, with no reasoning or artifact bytes.
- [ ] Reload the page and see the same chats, titles, models, and transcripts in the same recent-activity order.
- [ ] Open a restored chat, send a follow-up, and confirm the agent remembers the conversation.
- [ ] Create a DOCX or XLSX, reload, reopen the thread, and edit the same workspace file through a follow-up message.
- [ ] Start a second chat and confirm it receives a different EVE session and workspace.
- [ ] Archive a chat and confirm it stays hidden after reload while its EVE session is not reset.
- [ ] Interrupt a page during a running turn, reload it, and confirm EVE catches up the transcript and Supabase converges without duplicate events.
- [ ] Run `bun run web:test`, `bun run agent:test`, `bun run typecheck`, `bun run lint`, `bun run agent:build`, and `bun run build` successfully.

## Out of scope

- Supabase Auth, multiple users, sharing, teams, or public browser access to chat tables.
- Storing DOCX, XLSX, Markdown, generated previews, attachment bytes, or sandbox snapshots in Supabase Storage or Postgres.
- Local-folder selection, artifact export, artifact backup, or workspace migration.
- Permanent EVE session or sandbox deletion when a chat is archived.
- Search, pagination, branching, message editing, chat export, or automatic title generation with another model call.
- Migrating chats created before this feature or provisioning a local Supabase stack.
