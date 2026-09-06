# 01 - Run the supervised local browser

## Goal

Give Anchor OS one server-owned control path that can enable, inspect, and disable a visible PinchTab browser while preserving the `Anchor OS` profile between launches.

## Files

Create:

- `packages/browser-control/package.json`
- `packages/browser-control/types.ts`
- `packages/browser-control/pinchtab-process.ts`
- `packages/browser-control/pinchtab-mcp-bridge.ts`
- `packages/browser-control/browser-control-server.ts`
- `packages/browser-control/browser-control-server.test.ts`
- `packages/browser-control/pinchtab-process.test.ts`
- `packages/browser-control/pinchtab-mcp-bridge.test.ts`
- `apps/web/app/api/browser-control/route.ts`
- `apps/web/app/api/browser-control/mcp/route.ts`

Modify:

- `apps/web/package.json`
- `apps/web/next.config.ts`
- `package.json`
- `bun.lock`

> Note: the service lives in the `@anchor-os/browser-control` workspace package (mirroring `@anchor-os/agent`) instead of `apps/web/lib`. The Next.js route handlers are thin wrappers that import the package.

## Implementation notes

- Use the official MCP SDK to bridge the PinchTab stdio client to a loopback Streamable HTTP endpoint.
- Filter both tool discovery and tool calls through the spec allowlist. Preserve MCP image content blocks.
- On enable, check PinchTab health before starting `pinchtab server --background`. Find or create the persistent `Anchor OS` profile and launch it with headed mode explicitly.
- Track process ownership. Disable may stop an Anchor OS-owned server, but must leave a pre-existing server running.
- Keep a process-wide state machine that survives Next.js module reloads without creating duplicate PinchTab or MCP child processes.
- Start disabled and bind local endpoints to loopback only.

## Blocked by

None.

## Done when

- `GET /api/browser-control` reports the real `Off`, `Starting`, `On`, `Stopping`, or `Error` state.
- Enabling opens the persistent `Anchor OS` profile in a visible Chrome window without terminal work or Chrome debugging flags.
- Disabling closes owned processes, leaves pre-existing PinchTab processes alone, and a later enable reuses the same profile.
- The MCP endpoint advertises only the approved tools, rejects blocked tool names, and forwards screenshot image content unchanged.
- Focused tests cover state transitions, process ownership, tool filtering, and image forwarding without launching Chrome.
