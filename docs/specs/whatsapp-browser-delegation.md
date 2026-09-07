# WhatsApp browser delegation prototype

## Goal

Let the approved user delegate a browser task to Anchor OS from WhatsApp. The first message creates a durable Eve session and microsandbox workspace. Later messages from the same WhatsApp conversation resume that session. For the demo, Eve must inspect the work orders at `http://localhost:3100`, change one work order's priority through the visible interface, verify the saved value, and reply on WhatsApp.

This is a one-user prototype for tomorrow's demo, not a general WhatsApp integration.

## User flow

1. The operator starts PlantOps on port 3100, enables Anchor OS browser control, and runs `bun run dev` from `apps/web` to start the web app and Eve.
2. When WhatsApp is needed, the operator separately runs `bun run dev:whatsapp` from the repository root. The receiving account, `+91 7276411669`, connects through its saved Baileys credentials or a QR scan.
3. The approved sender, `+91 7028546994`, sends a text or voice note asking Anchor OS to review all work orders and change the priority of any eligible one.
4. Anchor OS accepts only that sender. Eve creates or resumes the session bound to the sender's direct-message conversation. The session receives its normal microsandbox workspace and the existing browser-control connection.
5. Eve opens `http://localhost:3100`, reviews the visible work-order list, chooses a work order whose priority is not already `High`, and changes it to `High` through visible controls.
6. If Eve asks for confirmation or another choice, WhatsApp renders the request as numbered text and the user's reply resumes the same turn.
7. Eve reloads or revisits the work order and verifies the saved priority from the page.
8. WhatsApp receives only the final result, naming the work order, its previous priority, and its new priority. A voice-note request receives a voice-note response when TTS succeeds.
9. A later message resumes the same session and workspace. `/reset` retires it so the next accepted message creates a fresh session and workspace.

## Requirements

- Use a custom Eve channel plus a standalone Baileys adapter. Eve owns durable sessions and workspaces; the adapter owns the long-lived WhatsApp socket, QR, credentials, media, and delivery.
- `bun run dev` from `apps/web` keeps its existing behavior: Next.js starts the colocated Eve development server without opening WhatsApp or printing a QR.
- `bun run dev:whatsapp` starts only the standalone adapter. It discovers the Eve process recorded by `withEve`, connects over a loopback WebSocket, and can run or restart independently of the web app.
- If Eve restarts on a different development port while the WhatsApp adapter remains running, the adapter rediscovers it, reconnects, and flushes accepted messages in arrival order.
- Accept direct messages only from the normalized E.164 sender `917028546994`. Ignore groups, broadcasts, history-sync events, self echoes, stickers, and every other sender without invoking Eve.
- Treat `917276411669` as the receiving account. Baileys establishes that identity through the linked-account credentials and QR flow. Do not treat the receiving number as an inbound allowlist entry.
- Map the approved WhatsApp conversation to one Eve continuation address. Use `turnPolicy: "queue"` so messages finish in arrival order.
- Supply a stable authenticated principal for the approved sender. Its auth attributes must request the existing Anchor browser connection without weakening browser access for other channels.
- Browser work remains conditional on Anchor OS's local browser-control status. If browser control is off or unhealthy, send a short WhatsApp instruction to enable it and do not start the browser task.
- Reuse the existing PinchTab MCP bridge, tool allowlist, headed `Anchor OS` Chrome profile, and Eve-session ownership header. Do not add a second browser runtime or direct automation path.
- Show WhatsApp's typing indicator while Eve works. Deliver completed assistant output only. Never send reasoning, connection discovery, tool calls, tool results, or assistant text whose `finishReason` is `tool-calls`.
- Preserve Eve's human-input flow. Render choices as numbered text and route the reply to the pending request rather than starting an unrelated turn.
- Support inbound WhatsApp voice notes with Deepgram transcription. Send Eve the transcript as text.
- Reply to a voice-note request with Cartesia speech converted to WhatsApp-compatible Ogg/Opus. Fall back to the final text response if Cartesia or audio conversion fails. If transcription fails, send a clear error and ask for text rather than sending unsupported audio to the selected model.
- Store Baileys credentials locally in an ignored configurable directory. Never commit credentials, API keys, raw QR data, phone-session secrets, or credential backups.
- Reconnect Baileys after recoverable socket failures and stay disconnected after logout or connection replacement. Reconnect the local Eve bridge whenever Eve restarts.
- Send a concise failure message when Eve, transcription, or delivery fails. Do not expose stack traces or provider details to WhatsApp.
- The PlantOps demo at port 3100 must expose a visible control for changing an existing work order's priority and persist the change in its existing local-storage state. There must be no hidden API or MCP shortcut for this action.

## Implementation decisions

- Keep Eve's channel under `packages/agent/agent/channels/whatsapp.ts` and the process-owning adapter at `packages/agent/whatsapp-server.ts`.
- Let `withEve` keep managing the local Eve process and its development port. The adapter reads Eve's local development-server registry and connects directly to `/whatsapp/socket`; an explicit socket URL remains available as an override.
- Adapt the transport, queueing, voice, QR, HITL, and delivery code from `/Users/shahidpatel/codes/hackathons/eve-wa-adapter/agent/channels/whatsapp.ts`. Do not copy its Eve 0.40 typings unchanged. Follow the bundled Eve 0.52.2 custom-channel contract in `packages/agent/node_modules/eve/docs/channels/custom.mdx`.
- Use the normalized WhatsApp JID as the Eve continuation address. `from(jid).send(...)` creates the first durable session and resumes it on later messages. Use `from(jid).reset(...)` for `/reset`.
- Dispatch each accepted turn with a user principal such as `authenticator: "whatsapp-demo"`, `principalType: "user"`, and a stable principal ID derived from the approved sender. Set `anchorOsBrowserControl: "on"` in its attributes so `packages/agent/agent/connections/browser.ts` can reuse the current authorization path.
- Check the existing browser-control status endpoint before dispatch. The dynamic connection must still perform its own status check when the turn starts.
- Keep WhatsApp configuration in environment variables. At minimum this includes the allowed sender, receiving number, credential directory, Eve socket URL, Deepgram key, Cartesia key, and Cartesia voice ID. Commit safe examples only.
- Add Baileys, Deepgram, Cartesia, QR rendering, and audio-conversion dependencies to `packages/agent`. Keep provider clients and FFmpeg work out of the web UI.
- Add the smallest priority-edit control to the existing PlantOps work-order detail flow. Reuse its store validation and local-storage persistence instead of introducing server state.
- Do not create a Supabase chat row for a WhatsApp session. WhatsApp-created chats will not appear in the Anchor OS web sidebar in this prototype.
- Keep the normal web-chat behavior unchanged. Web model selection, chat persistence, artifacts, attachments, and the browser-control toggle must continue to work as they do now.

## Demo / acceptance

- [ ] `bun run dev` from `apps/web` starts the web app and Eve without touching WhatsApp or printing a QR.
- [ ] `bun run dev:whatsapp` starts only one Baileys adapter and connects the receiving account `+91 7276411669` to the running Eve process.
- [ ] Restarting Eve, including on a different development port, does not require restarting WhatsApp; the adapter rediscovers it and reconnects.
- [ ] A message from any sender other than `+91 7028546994` is ignored and creates no Eve session.
- [ ] A text message from `+91 7028546994` creates one Eve session with a microsandbox workspace and receives a final text reply.
- [ ] A second message from the approved sender resumes the same Eve session and workspace.
- [ ] `/reset` retires the current session, and the next message creates a different session and fresh workspace.
- [ ] With browser control off, the approved sender receives an instruction to enable it and no browser action starts.
- [ ] With browser control on, this prompt completes through the visible UI: `Open http://localhost:3100, review all work orders, choose one whose priority is not High, change its priority to High, verify the saved value, and tell me what changed.`
- [ ] The headed Anchor OS browser visibly opens PlantOps, reviews the work-order list, opens one work order, changes its priority, and verifies the persisted value.
- [ ] The final WhatsApp reply names the selected work order and reports the previous and new priority.
- [ ] WhatsApp receives no reasoning, tool-call transients, intermediate assistant messages, or raw errors during the task.
- [ ] A voice note containing the same request is transcribed, runs the browser task, and receives the final answer as a WhatsApp voice note.
- [ ] If Cartesia fails, the same completed answer arrives as text. If Deepgram fails, the user receives a short request to resend the instruction as text.
- [ ] Reloading PlantOps preserves the changed priority. Resetting its demo data restores the known seed state for another rehearsal.
- [ ] Baileys credential directories and backups are ignored by Git.
- [ ] Focused channel, allowlist, delivery-filter, voice-fallback, browser-preflight, and priority-update tests pass, followed by the agent tests, typecheck, lint, and production build.

## Out of scope

- Showing WhatsApp-created chats in the Anchor OS web sidebar or continuing one conversation across WhatsApp and the web UI.
- More than one approved sender, group chats, broadcasts, contacts, or production account administration.
- Images, video, documents, locations, stickers, reactions, polls, quoted-message context, or general attachment handling.
- Proactive messages, schedules, campaigns, notifications, or initiating a WhatsApp conversation without an inbound message.
- Streaming partial answers, rich WhatsApp buttons, artifact delivery, or workspace file downloads through WhatsApp.
- Production hosting, multiple processes, horizontal scaling, a durable message broker, delivery receipts, analytics, or formal audit logs.
- A second browser controller, browser automation APIs in PlantOps, or unattended browser access while Anchor OS browser control is off.
- General PlantOps editing. Only the priority control needed for the browser demo belongs in this slice.
