# 04 - Load and resume saved chats

## Goal

Reloading Anchor OS restores the `demo` user's sidebar and transcript, then reconnects each opened chat to its original EVE session.

## Files

Modify:
- `apps/web/app/api/chats/[chatId]/route.ts`
- `apps/web/lib/chat-store.ts`
- `apps/web/lib/chat-client.ts`
- `apps/web/hooks/use-chat-persistence.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`

## Implementation notes

- Fetch thread summaries on load and fetch ordered events and projected messages for the selected thread.
- Mount restored EVE runtimes with saved `initialEvents`, `initialSession: { sessionId, streamIndex }`, and `resume: true`.
- EVE options are construction-time values. Mount a pane only after its saved state is ready and remount when its application thread ID changes.
- Render saved history while EVE catches up, but disable messages and HITL responses during `resuming`.
- Keep the existing artifact provider inside the restored EVE runtime so it reads the same session-scoped manifest and workspace artifacts.

## Blocked by

- 03 - Save safe EVE history

## Done when

- A reload shows the same thread and transcript without creating a new EVE session.
- A follow-up after reload uses the prior conversation context.
- A DOCX or XLSX created before reload can be edited in place through that restored thread.

