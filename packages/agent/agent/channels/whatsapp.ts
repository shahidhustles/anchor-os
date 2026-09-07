import {
  WS,
  defineChannel,
  type ChannelEvents,
  type ChannelFrom,
  type WebSocketPeer,
} from "eve/channels";

import { fetchBrowserControlStatus } from "../lib/browser-control";
import {
  WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE,
  canDispatchBrowserTask,
  dropLastWhatsAppReplyMode,
  enqueueWhatsAppTask,
  isAllowedWhatsAppJid,
  isResetCommand,
  parseWhatsAppBridgeInbound,
  queueWhatsAppReplyMode,
  readWhatsAppConfig,
  renderWhatsAppInputRequest,
  resolveWhatsAppInputResponse,
  shouldDeliverAssistantMessage,
  takeWhatsAppReplyMode,
  whatsappUserAuth,
  type WhatsAppBridgeOutbound,
  type WhatsAppPendingInput,
  type WhatsAppReplyMode,
  type WhatsAppSerialQueue,
} from "../lib/whatsapp";

type WhatsAppState = {
  jid: string;
  voiceReply: boolean;
};

type WhatsAppRuntime = {
  peer: WebSocketPeer | null;
  outboundQueue: WhatsAppBridgeOutbound[];
  from: ChannelFrom<WhatsAppState> | null;
  failedSessions: Set<string>;
  inboundQueue: WhatsAppSerialQueue;
  pendingInputs: Map<string, WhatsAppPendingInput[]>;
  replyModes: Map<string, WhatsAppReplyMode[]>;
  activeReplyModes: Map<string, WhatsAppReplyMode>;
};

type WhatsAppChannelContext = {
  readonly state: WhatsAppState;
};

declare global {
  var __anchorWhatsAppRuntime: WhatsAppRuntime | undefined;
}

function getRuntime(): WhatsAppRuntime {
  const runtime = (globalThis.__anchorWhatsAppRuntime ??= {
    peer: null,
    outboundQueue: [],
    from: null,
    failedSessions: new Set(),
    inboundQueue: { tail: Promise.resolve() },
    pendingInputs: new Map(),
    replyModes: new Map(),
    activeReplyModes: new Map(),
  });
  runtime.inboundQueue ??= { tail: Promise.resolve() };
  runtime.outboundQueue ??= [];
  runtime.pendingInputs ??= new Map();
  runtime.replyModes ??= new Map();
  runtime.activeReplyModes ??= new Map();
  return runtime;
}

function sendToWhatsApp(message: WhatsAppBridgeOutbound): boolean {
  const runtime = getRuntime();
  const peer = runtime.peer;
  if (peer === null) {
    runtime.outboundQueue.push(message);
    return false;
  }
  try {
    peer.send(JSON.stringify(message));
    return true;
  } catch (error) {
    runtime.peer = null;
    runtime.outboundQueue.unshift(message);
    console.error("[whatsapp] could not send to the adapter", error);
    return false;
  }
}

function flushWhatsAppQueue(runtime: WhatsAppRuntime): void {
  const queued = runtime.outboundQueue.splice(0);
  for (const message of queued) sendToWhatsApp(message);
}

async function dispatchMessage(
  runtime: WhatsAppRuntime,
  jid: string,
  text: string,
  replyMode: WhatsAppReplyMode,
): Promise<void> {
  if (runtime.from === null) throw new Error("WhatsApp channel is not ready");
  queueWhatsAppReplyMode(runtime.replyModes, jid, replyMode);
  try {
    await runtime.from(jid).send(text, {
      auth: whatsappUserAuth(jid),
      state: { jid, voiceReply: replyMode === "voice" },
    });
  } catch (error) {
    dropLastWhatsAppReplyMode(runtime.replyModes, jid);
    throw error;
  }
}

async function tryRespondToPendingInput(
  runtime: WhatsAppRuntime,
  jid: string,
  text: string,
): Promise<boolean> {
  const pendingQueue = runtime.pendingInputs.get(jid);
  if (pendingQueue === undefined || runtime.from === null) return false;
  const pending = pendingQueue[0];
  if (pending === undefined) return false;

  const resolution = resolveWhatsAppInputResponse(pending, text);
  if (resolution.kind === "invalid-option") {
    sendToWhatsApp({
      kind: "text",
      jid,
      text: `Invalid choice. Reply with a number from 1 to ${resolution.optionCount}.`,
    });
    return true;
  }

  await runtime.from(jid).respond([resolution.response], { auth: whatsappUserAuth(jid) });
  pendingQueue.shift();
  if (pendingQueue.length === 0) runtime.pendingInputs.delete(jid);
  return true;
}

async function handleInboundMessage(
  runtime: WhatsAppRuntime,
  message: { readonly jid: string; readonly text: string; readonly replyMode: WhatsAppReplyMode },
): Promise<void> {
  if (!isAllowedWhatsAppJid(message.jid, readWhatsAppConfig().allowedSender)) return;

  if (isResetCommand(message.text)) {
    if (runtime.from === null) return;
    await runtime.from(message.jid).reset({
      reason: "User requested a fresh WhatsApp conversation",
    });
    runtime.pendingInputs.delete(message.jid);
    runtime.replyModes.delete(message.jid);
    runtime.activeReplyModes.delete(message.jid);
    sendToWhatsApp({
      kind: "text",
      jid: message.jid,
      text: "Conversation reset. Your next message starts a fresh workspace.",
    });
    return;
  }

  if (await tryRespondToPendingInput(runtime, message.jid, message.text)) return;

  const browserStatus = await fetchBrowserControlStatus();
  if (!canDispatchBrowserTask(browserStatus)) {
    sendToWhatsApp({
      kind: "text",
      jid: message.jid,
      text: WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE,
    });
    return;
  }

  sendToWhatsApp({ kind: "presence", jid: message.jid, state: "composing" });
  await dispatchMessage(runtime, message.jid, message.text, message.replyMode);
}

const channel = defineChannel<WhatsAppState, WhatsAppChannelContext>({
  kindHint: "whatsapp",
  turnPolicy: "queue",
  state: { jid: "", voiceReply: false },
  context(state) {
    return { state };
  },
  routes: [
    WS("/whatsapp/socket", async (_request, { from }) => {
      const runtime = getRuntime();
      runtime.from = from;
      return {
        open(peer) {
          if (runtime.peer !== null && runtime.peer !== peer) {
            runtime.peer.close(1012, "A newer WhatsApp adapter connected");
          }
          runtime.peer = peer;
          console.info("[whatsapp] adapter connected");
          flushWhatsAppQueue(runtime);
        },
        message(peer, frame) {
          if (runtime.peer !== peer) return;
          let message;
          try {
            message = parseWhatsAppBridgeInbound(frame.json<unknown>());
          } catch {
            return;
          }
          if (message === null) return;
          void enqueueWhatsAppTask(runtime.inboundQueue, async () => {
            try {
              await handleInboundMessage(runtime, message);
            } catch (error) {
              console.error("[whatsapp] failed to process an inbound message", error);
              sendToWhatsApp({
                kind: "text",
                jid: message.jid,
                text: "I could not start that task. Please try again.",
              });
            }
          });
        },
        close(peer) {
          if (runtime.peer === peer) runtime.peer = null;
          console.info("[whatsapp] adapter disconnected");
        },
        error(peer, error) {
          if (runtime.peer === peer) runtime.peer = null;
          console.error("[whatsapp] adapter connection failed", error);
        },
      };
    }),
  ],
  events: {
    async "turn.started"(_event, channelContext) {
      if (channelContext.state.jid === "") return;
      const runtime = getRuntime();
      const mode = takeWhatsAppReplyMode(
        runtime.replyModes,
        channelContext.state.jid,
        channelContext.state.voiceReply ? "voice" : "text",
      );
      runtime.activeReplyModes.set(channelContext.state.jid, mode);
      sendToWhatsApp({
        kind: "presence",
        jid: channelContext.state.jid,
        state: "composing",
      });
    },
    async "actions.requested"(_event, channelContext) {
      if (channelContext.state.jid !== "") {
        sendToWhatsApp({
          kind: "presence",
          jid: channelContext.state.jid,
          state: "composing",
        });
      }
    },
    async "input.requested"(event, channelContext) {
      if (channelContext.state.jid === "") return;
      for (const request of event.requests) {
        const pendingQueue = getRuntime().pendingInputs.get(channelContext.state.jid) ?? [];
        if (pendingQueue.some((pending) => pending.requestId === request.requestId)) continue;
        pendingQueue.push({
          allowFreeform: request.allowFreeform ?? request.options?.length === 0,
          options: request.options ?? [],
          requestId: request.requestId,
        });
        getRuntime().pendingInputs.set(channelContext.state.jid, pendingQueue);
        sendToWhatsApp({
          kind: "text",
          jid: channelContext.state.jid,
          text: renderWhatsAppInputRequest(request),
        });
      }
    },
    async "message.completed"(event, channelContext) {
      if (channelContext.state.jid === "") return;
      if (!shouldDeliverAssistantMessage(event)) return;
      const runtime = getRuntime();
      const replyMode =
        runtime.activeReplyModes.get(channelContext.state.jid) ??
        (channelContext.state.voiceReply ? "voice" : "text");
      sendToWhatsApp({ kind: replyMode, jid: channelContext.state.jid, text: event.message });
    },
    async "session.waiting"(_event, channelContext, sessionContext) {
      const runtime = getRuntime();
      runtime.failedSessions.delete(sessionContext.session.id);
      if (!runtime.pendingInputs.has(channelContext.state.jid)) {
        runtime.activeReplyModes.delete(channelContext.state.jid);
      }
      if (channelContext.state.jid !== "") {
        sendToWhatsApp({ kind: "presence", jid: channelContext.state.jid, state: "paused" });
      }
    },
    async "turn.failed"(_event, channelContext, sessionContext) {
      const runtime = getRuntime();
      runtime.pendingInputs.delete(channelContext.state.jid);
      runtime.activeReplyModes.delete(channelContext.state.jid);
      if (
        channelContext.state.jid === "" ||
        runtime.failedSessions.has(sessionContext.session.id)
      ) {
        return;
      }
      runtime.failedSessions.add(sessionContext.session.id);
      sendToWhatsApp({
        kind: "text",
        jid: channelContext.state.jid,
        text: "That task failed. Please try again.",
      });
    },
    async "session.failed"(event, channelContext) {
      const runtime = getRuntime();
      runtime.pendingInputs.delete(channelContext.state.jid);
      runtime.activeReplyModes.delete(channelContext.state.jid);
      if (channelContext.state.jid === "" || runtime.failedSessions.has(event.sessionId)) return;
      runtime.failedSessions.add(event.sessionId);
      sendToWhatsApp({
        kind: "text",
        jid: channelContext.state.jid,
        text: "This session failed. Send /reset to start again.",
      });
    },
  } satisfies ChannelEvents<WhatsAppChannelContext>,
});

export default channel;
