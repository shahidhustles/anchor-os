# 06 - Recover interrupted chats

## Goal

An interrupted page or temporarily failed persistence request converges back to the durable EVE transcript without duplicate database history.

## Files

Modify:
- `packages/agent/agent/agent.ts`
- `apps/web/hooks/use-chat-persistence.ts`
- `apps/web/lib/chat-client.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`
- `apps/web/lib/chat-sanitizer.test.ts`

## Implementation notes

- Set `limits.sessionTimeoutMs: false` on the EVE agent.
- Retry only idempotent event, cursor, and snapshot writes. On reload, let EVE replay from the saved cursor or from index `0`; repeated event IDs must collapse in Supabase.
- If EVE reports that the stored session is unavailable, retain the Supabase transcript, show a clear error, and keep the composer disabled. Never switch the thread to a fresh session silently.
- Keep database errors separate from model and artifact errors so the UI states which part failed.

## Blocked by

- 05 - Persist thread controls

## Done when

- Reloading during a running turn catches up to its final state and does not duplicate event rows.
- A simulated repeated event or snapshot write remains idempotent.
- An unavailable EVE session leaves readable saved messages and a disabled composer.
- The repository's web tests, agent tests, typecheck, lint, agent build, and application build pass.
