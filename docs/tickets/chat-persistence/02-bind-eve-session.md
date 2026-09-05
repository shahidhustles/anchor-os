# 02 - Bind a chat to its EVE session

## Goal

Every usable chat has a Supabase thread before sending, and its first accepted EVE turn records the durable session cursor on that thread.

## Files

Create:
- `apps/web/lib/chat-client.ts`
- `apps/web/hooks/use-chat-persistence.ts`

Modify:
- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`

## Implementation notes

- Create the initial chat and New chat rows through the API before mounting an enabled composer.
- Wire `onSessionChange` through `useEveAgentRuntime` and persist both `sessionId` and `streamIndex` immediately.
- Keep each `ChatPane` mounted while hidden. Use the application thread UUID as its React key and keep `sandbox_id` out of the continuation contract.
- Show a retryable error and keep sending disabled when thread creation or session binding fails.

## Blocked by

- 01 - Persist demo threads

## Done when

- Sending the first prompt leaves one thread row with a non-null `eve_session_id` and a saved `eve_stream_index`.
- Starting a second chat records a different EVE session while the first turn may continue running.

