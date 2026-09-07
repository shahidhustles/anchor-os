# 01 - Delegate a browser task from WhatsApp

## Goal

Make the approved sender complete the full text-message demo. A WhatsApp message creates or resumes an Eve workspace, drives the visible PlantOps interface, changes one work order's priority, verifies the saved value, and receives only the final result.

## Files

Create:

- `packages/agent/agent/channels/whatsapp.ts`
- `packages/agent/agent/lib/whatsapp.ts`
- `packages/agent/agent/lib/whatsapp.test.ts`
- `apps/plant-maintenance-demo/src/components/work-order-priority-editor.tsx`
- `apps/plant-maintenance-demo/src/components/work-order-priority-editor.test.tsx`

Modify:

- `package.json`
- `packages/agent/package.json`
- `bun.lock`
- `.gitignore`
- `apps/web/.env.example`
- `apps/plant-maintenance-demo/package.json`
- `apps/plant-maintenance-demo/src/app/work-orders/[workOrderId]/page.tsx`
- `apps/plant-maintenance-demo/src/lib/maintenance-store.ts`
- `apps/plant-maintenance-demo/src/lib/maintenance-store.test.ts`

## Implementation notes

- Adapt the Baileys socket, bootstrap route, queue, QR, and final-delivery behavior from `/Users/shahidpatel/codes/hackathons/eve-wa-adapter/agent/channels/whatsapp.ts` to Eve 0.52.2. Keep the channel text-only in this ticket.
- Start the socket only when `ANCHOR_WHATSAPP_ENABLED=1`. `bun run dev:whatsapp` starts Eve on port 2000, waits for health, then starts the web app on port 3000 with `EVE_BASE_URL` set to that Eve process. It cannot run beside `bun dev` because both own port 3000.
- Accept direct messages only from normalized sender `917028546994`. The receiving account `917276411669` comes from the linked Baileys credentials.
- Use the sender JID as the continuation address, `turnPolicy: "queue"`, and a stable WhatsApp user principal whose attributes set `anchorOsBrowserControl: "on"`.
- Check browser-control health before dispatch. If it is off or unhealthy, tell the sender to enable it and create no browser turn.
- Deliver only completed assistant messages. Skip empty output and `finishReason: "tool-calls"`. Support `/reset` so the next message receives a new Eve session and workspace.
- Add a labeled priority selector and save action to the existing work-order detail page. Persist through `maintenance-store.ts`; do not add an API or bypass the visible controls.
- Ignore Baileys credential directories and backups. Commit configuration names and empty examples, never secrets.

## Blocked by

None.

## Done when

- `bun dev` does not touch WhatsApp, while `bun run dev:whatsapp` connects one Baileys socket for `+91 7276411669`.
- Any sender except `+91 7028546994` is ignored without creating an Eve session.
- Two accepted messages use the same Eve session and microsandbox workspace; `/reset` makes the following message use a new session and workspace.
- With browser control off, WhatsApp receives a short enablement instruction and PlantOps remains unchanged.
- With browser control on, the approved sender can send `Open http://localhost:3100, review all work orders, choose one whose priority is not High, change its priority to High, verify the saved value, and tell me what changed.`
- The headed browser visibly uses PlantOps controls, the changed priority survives reload, and the final WhatsApp reply names the work order plus its old and new priority.
- WhatsApp receives no reasoning, tool-call transients, intermediate assistant text, or raw errors.
- Focused allowlist, startup guard, session routing, browser preflight, delivery filter, priority update, and persistence tests pass. Agent tests, PlantOps tests, typecheck, lint, and production builds pass.
