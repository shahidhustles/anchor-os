# 02 - Run the same delegation by voice

## Goal

Let the approved sender delegate the same browser task with a WhatsApp voice note and finish the demo cleanly when speech providers, the socket, or Eve need recovery or human input.

## Files

Create:

- `packages/agent/agent/lib/whatsapp-voice.ts`
- `packages/agent/agent/lib/whatsapp-voice.test.ts`

Modify:

- `packages/agent/agent/channels/whatsapp.ts`
- `packages/agent/agent/lib/whatsapp.ts`
- `packages/agent/agent/lib/whatsapp.test.ts`
- `packages/agent/whatsapp-server.ts`
- `packages/agent/package.json`
- `bun.lock`
- `apps/web/.env.example`

## Implementation notes

- Adapt Deepgram transcription, Cartesia synthesis, and Ogg/Opus conversion from the reference adapter. Put provider and FFmpeg code in `whatsapp-voice.ts`, outside the web UI.
- Send the transcript to Eve as text. If Deepgram fails, ask the sender to resend as text. Do not forward raw audio to a model that may not accept it.
- Reply to an accepted voice note with a voice note. If Cartesia or conversion fails, send the completed answer as text.
- Preserve Eve human-input requests. Render choices as numbered WhatsApp text and route replies through `respond()` so they continue the pending turn.
- Keep one Baileys socket and one listener in the standalone adapter. Reconnect after recoverable WhatsApp failures, but stop after logout or connection replacement. Reconnect independently after Eve restarts and keep queued messages in arrival order.
- Expose only short user-facing failures. Provider errors and stack traces stay in local logs.

## Blocked by

- 01 - Delegate a browser task from WhatsApp

## Done when

- A voice note with the port 3100 priority-change request is transcribed, runs in the same durable Eve session and workspace, and returns the verified result as a WhatsApp voice note.
- A Cartesia or conversion failure returns the same completed answer as text; a Deepgram failure asks for a text message and starts no malformed Eve turn.
- A numbered human-input reply resumes the pending request instead of starting a separate turn.
- Eve restarts and recoverable disconnects do not require restarting WhatsApp, duplicate replies, or lose accepted queued messages. Logout and connection replacement do not reconnect automatically.
- Focused transcription, TTS fallback, HITL routing, queue, reconnect, and duplicate-listener tests pass. Agent tests, typecheck, lint, and production builds pass.
