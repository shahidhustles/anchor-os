# 05 - Persist thread controls

## Goal

Thread titles, model choices, ordering, and archive actions survive reloads.

## Files

Modify:
- `apps/web/lib/chat-client.ts`
- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`

## Implementation notes

- Persist the existing first-user-message title when it is first derived. Do not add model-generated titles.
- Persist model changes only while the thread is idle, matching the current UI rule.
- Update `last_message_at` when a user message is accepted and sort the sidebar by database recency.
- Change the trash action to soft archive. Keep cancellation of an active UI run, but do not call EVE reset or delete sandbox state.
- Replace the current "Chats reset when this app reloads" footer with accurate persistence copy.

## Blocked by

- 04 - Load and resume saved chats

## Done when

- A renamed-by-first-message title and selected model remain unchanged after reload.
- Sending in an older chat moves it to the top after reload.
- Archiving a chat hides it after reload and leaves its EVE session untouched.

