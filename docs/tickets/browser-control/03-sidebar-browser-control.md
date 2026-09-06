# 03 - Control the live browser from the sidebar

## Goal

Let the user enable, monitor, retry, and stop browser control from the sidebar, then prove the complete visible browsing flow through Eve.

## Files

Create:

- `apps/web/lib/browser-control-client.ts`
- `apps/web/components/anchor-os/browser-control-toggle.tsx`
- `apps/web/lib/browser-control-client.test.ts`

Modify:

- `apps/web/app/page.tsx`
- `apps/web/app/page.test.tsx`

## Implementation notes

- Place the control at the bottom of the existing sidebar above the chat-persistence note.
- Render `Off`, `Starting`, `On`, `Stopping`, and `Error` without optimistic success. Show Retry for recoverable failures.
- Keep the setting device-wide and runtime-only. Read the server state after page load rather than restoring an old client value.
- Extend the existing Eve header callback with the current ready state. Send `enabled` only when the server reports `On`.
- Turning the toggle off must revoke later turns immediately and end any active browser call. Do not stop a PinchTab server Anchor OS does not own.
- Preserve existing chat switching, cancellation, persistence, artifact panels, and model selection.

## Blocked by

- 02 - Give Eve browser tools only when enabled

## Done when

- The sidebar toggle moves through real service states and remains off when startup fails.
- Enabling launches visible Chrome, and a natural-language request makes Eve navigate and interact while the user watches.
- The same `Anchor OS` profile retains a demonstrated login across disable and re-enable when the website session remains valid.
- Eve asks before a demonstrated external side effect and waits for the user's answer.
- Turning the toggle off removes browser access from the next message and a second chat cannot take over an active browser run.
- The browser-control tests and the repo typecheck, lint, web tests, and agent tests pass.
