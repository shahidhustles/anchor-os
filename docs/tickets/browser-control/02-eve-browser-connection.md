# 02 - Give Eve browser tools only when enabled

## Goal

Make the approved PinchTab tools discoverable and callable by Eve on enabled turns, while disabled or unhealthy turns have no browser connection.

## Files

Create:

- `packages/agent/agent/connections/browser.ts`
- `packages/agent/agent/lib/browser-control.ts`
- `packages/agent/agent/lib/browser-control.test.ts`

Modify:

- `packages/agent/agent/channels/eve.ts`
- `packages/agent/agent/instructions.md`
- `packages/agent/package.json`
- `bun.lock`

## Implementation notes

- Follow Eve 0.52.1 dynamic connection docs. Resolve the connection on `turn.started` so an existing chat sees the next toggle change.
- Extend the existing server-defined header and auth-attribute pattern. Do not accept browser authority from message text or tool input.
- Apply the approved tool allowlist in Eve as a second boundary.
- Include the Eve session ID in server-only bridge requests so the local service can reject concurrent browser control from another chat.
- Teach Eve to find the connection, observe before acting, refresh snapshots after page changes, ask before external side effects, and stop for CAPTCHA or human verification.

## Blocked by

- 01 - Run the supervised local browser

## Done when

- An Eve turn sent with browser control off has no `browser` connection or PinchTab tools.
- An enabled turn can discover an approved `browser__pinchtab_*` tool and complete a harmless live navigation through the local bridge.
- A blocked tool remains unavailable even if PinchTab advertises it.
- Changing the setting affects the next turn of an existing Eve session without creating a new chat.
- Two Eve sessions cannot interleave browser calls. The second receives a clear busy error.
- Agent tests cover enabled, disabled, unhealthy, blocked-tool, and conflicting-session cases.
