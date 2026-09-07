import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  getContentType,
  makeWASocket,
  normalizeMessageContent,
  useMultiFileAuthState,
  type BaileysEventMap,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { defineChannel, POST, type ChannelEvents, type ChannelFrom } from "eve/channels";
import QRCode from "qrcode";

import { fetchBrowserControlStatus } from "../lib/browser-control";
import {
  WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE,
  canDispatchBrowserTask,
  disconnectStatusCode,
  dropLastWhatsAppReplyMode,
  enqueueWhatsAppTask,
  isAllowedWhatsAppSender,
  isExpectedWhatsAppReceiver,
  isResetCommand,
  markWhatsAppListenersAttached,
  queueWhatsAppReplyMode,
  readWhatsAppConfig,
  renderWhatsAppInputRequest,
  resolveWhatsAppInputResponse,
  shouldDeliverAssistantMessage,
  shouldReconnectWhatsApp,
  splitWhatsAppText,
  takeWhatsAppReplyMode,
  whatsappContinuationAddress,
  whatsappUserAuth,
  type WhatsAppConfig,
  type WhatsAppPendingInput,
  type WhatsAppReplyMode,
  type WhatsAppSerialQueue,
} from "../lib/whatsapp";
import {
  deliverWhatsAppVoiceOrText,
  prepareWhatsAppVoiceMessage,
  WHATSAPP_VOICE_TRANSCRIPTION_FAILURE_MESSAGE,
  type PreparedVoiceMessage,
} from "../lib/whatsapp-voice";

type WhatsAppState = {
  jid: string;
  voiceReply: boolean;
};

type QueuedMessage = {
  readonly jid: string;
  readonly text: string;
  readonly replyMode: WhatsAppReplyMode;
};

type WhatsAppRuntime = {
  socket: WASocket | null;
  starting: Promise<WASocket> | null;
  from: ChannelFrom<WhatsAppState> | null;
  queue: QueuedMessage[];
  bootstrapTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  failedSessions: Set<string>;
  inboundQueue: WhatsAppSerialQueue;
  listenerSockets: WeakSet<object>;
  pendingInputs: Map<string, WhatsAppPendingInput[]>;
  replyModes: Map<string, WhatsAppReplyMode[]>;
  activeReplyModes: Map<string, WhatsAppReplyMode>;
  receiverVerified: boolean;
};

type WhatsAppChannelContext = {
  readonly state: WhatsAppState;
  readonly socket: WASocket | null;
};

declare global {
  var __anchorWhatsAppRuntime: WhatsAppRuntime | undefined;
}

const config = readWhatsAppConfig();

function getRuntime(): WhatsAppRuntime {
  const runtime = (globalThis.__anchorWhatsAppRuntime ??= {
    socket: null,
    starting: null,
    from: null,
    queue: [],
    bootstrapTimer: null,
    reconnectTimer: null,
    failedSessions: new Set(),
    inboundQueue: { tail: Promise.resolve() },
    listenerSockets: new WeakSet(),
    pendingInputs: new Map(),
    replyModes: new Map(),
    activeReplyModes: new Map(),
    receiverVerified: false,
  });
  runtime.inboundQueue ??= { tail: Promise.resolve() };
  runtime.listenerSockets ??= new WeakSet();
  runtime.pendingInputs ??= new Map();
  runtime.replyModes ??= new Map();
  runtime.activeReplyModes ??= new Map();
  return runtime;
}

async function sendText(socket: WASocket, jid: string, text: string): Promise<void> {
  for (const part of splitWhatsAppText(text)) {
    await socket.sendMessage(jid, { text: part });
  }
}

async function sendTyping(socket: WASocket, jid: string, state: "composing" | "paused") {
  try {
    await socket.sendPresenceUpdate(state, jid);
  } catch {
    return;
  }
}

async function dispatchMessage(runtime: WhatsAppRuntime, message: QueuedMessage): Promise<void> {
  if (runtime.from === null) {
    runtime.queue.push(message);
    scheduleBootstrap(runtime);
    return;
  }

  queueWhatsAppReplyMode(runtime.replyModes, message.jid, message.replyMode);
  try {
    await runtime.from(message.jid).send(message.text, {
      auth: whatsappUserAuth(message.jid),
      state: { jid: message.jid, voiceReply: message.replyMode === "voice" },
    });
  } catch (error) {
    dropLastWhatsAppReplyMode(runtime.replyModes, message.jid);
    throw error;
  }
}

async function tryRespondToPendingInput(
  runtime: WhatsAppRuntime,
  jid: string,
  text: string,
  socket: WASocket,
): Promise<boolean> {
  const pendingQueue = runtime.pendingInputs.get(jid);
  const pending = pendingQueue?.[0];
  if (pending === undefined || runtime.from === null) return false;

  const resolution = resolveWhatsAppInputResponse(pending, text);
  if (resolution.kind === "invalid-option") {
    await sendText(
      socket,
      jid,
      `Invalid choice. Reply with a number from 1 to ${resolution.optionCount}.`,
    );
    return true;
  }

  await runtime.from(jid).respond([resolution.response], { auth: whatsappUserAuth(jid) });
  pendingQueue.shift();
  if (pendingQueue.length === 0) runtime.pendingInputs.delete(jid);
  return true;
}

async function handleInboundMessage(
  runtime: WhatsAppRuntime,
  message: WAMessage,
  allowedSender: string,
): Promise<void> {
  if (!runtime.receiverVerified) return;
  if (message.key.fromMe === true) return;
  if (!isAllowedWhatsAppSender(message.key, allowedSender)) return;

  const jid = whatsappContinuationAddress(message.key);
  if (jid === null) return;

  const content = normalizeMessageContent(message.message);
  const type = getContentType(content);
  const text =
    type === "conversation"
      ? content?.conversation
      : type === "extendedTextMessage"
        ? content?.extendedTextMessage?.text
        : undefined;
  if (type !== "audioMessage" && (text === undefined || text.trim() === "")) return;

  const socket = runtime.socket;
  if (socket === null) return;

  try {
    await socket.readMessages([message.key]);
  } catch {
    // A read receipt is helpful but does not affect delivery.
  }

  if (text !== undefined && isResetCommand(text)) {
    if (runtime.from === null) {
      await sendText(socket, jid, "WhatsApp is still starting. Try /reset again in a moment.");
      return;
    }
    await runtime.from(jid).reset({ reason: "User requested a fresh WhatsApp conversation" });
    runtime.pendingInputs.delete(jid);
    runtime.replyModes.delete(jid);
    runtime.activeReplyModes.delete(jid);
    await sendText(socket, jid, "Conversation reset. Your next message starts a fresh workspace.");
    return;
  }

  if (text !== undefined && (await tryRespondToPendingInput(runtime, jid, text, socket))) return;

  const browserStatus = await fetchBrowserControlStatus();
  if (!canDispatchBrowserTask(browserStatus)) {
    await sendText(socket, jid, WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE);
    return;
  }

  await sendTyping(socket, jid, "composing");
  if (type === "audioMessage") {
    let prepared: PreparedVoiceMessage;
    try {
      const audio = await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger: socket.logger,
          reuploadRequest: socket.updateMediaMessage,
        },
      );
      prepared = await prepareWhatsAppVoiceMessage(
        audio,
        content?.audioMessage?.mimetype ?? "audio/ogg",
      );
    } catch (error) {
      console.error("[whatsapp] could not download the voice note", error);
      await sendText(socket, jid, WHATSAPP_VOICE_TRANSCRIPTION_FAILURE_MESSAGE);
      await sendTyping(socket, jid, "paused");
      return;
    }
    if (prepared.kind !== "ready") {
      if (prepared.kind === "failed") {
        console.error("[whatsapp] could not transcribe the voice note", prepared.error);
      }
      await sendText(socket, jid, WHATSAPP_VOICE_TRANSCRIPTION_FAILURE_MESSAGE);
      await sendTyping(socket, jid, "paused");
      return;
    }
    await dispatchMessage(runtime, { jid, replyMode: "voice", text: prepared.text });
    return;
  }

  await dispatchMessage(runtime, { jid, replyMode: "text", text: text ?? "" });
}

function attachSocketListeners(
  runtime: WhatsAppRuntime,
  socket: WASocket,
  enabledConfig: Extract<WhatsAppConfig, { enabled: true }>,
): void {
  if (!markWhatsAppListenersAttached(runtime.listenerSockets, socket)) return;

  socket.ev.on("messages.upsert", (event: BaileysEventMap["messages.upsert"]) => {
    if (event.type !== "notify") return;
    for (const message of event.messages) {
      void enqueueWhatsAppTask(runtime.inboundQueue, async () => {
        try {
          await handleInboundMessage(runtime, message, enabledConfig.allowedSender);
        } catch (error) {
          console.error("[whatsapp] failed to process an inbound message", error);
          const jid = whatsappContinuationAddress(message.key);
          if (jid !== null && runtime.socket !== null) {
            await sendText(runtime.socket, jid, "I could not start that task. Please try again.");
          }
        }
      });
    }
  });

  socket.ev.on("connection.update", (update) => {
    if (update.qr !== undefined) {
      void QRCode.toString(update.qr, { type: "terminal", small: true })
        .then((rendered) => {
          console.info("[whatsapp] Scan this QR in WhatsApp under Linked devices.\n");
          console.info(rendered);
        })
        .catch((error: unknown) => {
          console.error("[whatsapp] could not render the login QR", error);
        });
    }

    if (update.connection === "open") {
      const linkedPhoneNumber = socket.user?.phoneNumber ?? socket.user?.id;
      runtime.receiverVerified = isExpectedWhatsAppReceiver(
        linkedPhoneNumber,
        enabledConfig.receivingNumber,
      );
      if (!runtime.receiverVerified) {
        console.error(
          `[whatsapp] linked account does not match configured receiver ${enabledConfig.receivingNumber}`,
        );
        return;
      }
      console.info("[whatsapp] connected");
      scheduleBootstrap(runtime, 0);
      return;
    }

    if (update.connection !== "close" || runtime.socket !== socket) return;
    const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
    runtime.socket = null;
    runtime.starting = null;
    runtime.receiverVerified = false;
    const reconnect = shouldReconnectWhatsApp(statusCode, [
      DisconnectReason.loggedOut,
      DisconnectReason.connectionReplaced,
    ]);
    console.error(`[whatsapp] disconnected with status ${statusCode ?? "unknown"}`);
    if (reconnect && runtime.reconnectTimer === null) {
      runtime.reconnectTimer = setTimeout(() => {
        runtime.reconnectTimer = null;
        void startSocket(runtime, enabledConfig).catch(() => undefined);
      }, 1_000);
    }
  });
}

async function startSocket(
  runtime: WhatsAppRuntime,
  enabledConfig: Extract<WhatsAppConfig, { enabled: true }>,
): Promise<WASocket> {
  if (runtime.socket !== null) return runtime.socket;
  if (runtime.starting !== null) return runtime.starting;

  runtime.starting = (async () => {
    const { state, saveCreds } = await useMultiFileAuthState(enabledConfig.authDir);
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Anchor OS"),
      markOnlineOnConnect: false,
    });
    runtime.socket = socket;
    socket.ev.on("creds.update", saveCreds);
    attachSocketListeners(runtime, socket, enabledConfig);
    return socket;
  })().catch((error: unknown) => {
    runtime.socket = null;
    console.error("[whatsapp] could not start", error);
    throw error;
  });

  try {
    return await runtime.starting;
  } finally {
    runtime.starting = null;
  }
}

async function bootstrap(runtime: WhatsAppRuntime): Promise<void> {
  runtime.bootstrapTimer = null;
  if (runtime.from !== null) return;
  const port = process.env.PORT ?? "2000";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/whatsapp/bootstrap`, {
      method: "POST",
    });
    if (response.ok) return;
  } catch {
    // The app can still be starting. Retry without blocking its startup.
  }
  scheduleBootstrap(runtime, 1_000);
}

function scheduleBootstrap(runtime: WhatsAppRuntime, delay = 1_000): void {
  if (runtime.bootstrapTimer !== null || runtime.from !== null) return;
  runtime.bootstrapTimer = setTimeout(() => void bootstrap(runtime), delay);
}

const channel = defineChannel<WhatsAppState, WhatsAppChannelContext>({
  kindHint: "whatsapp",
  turnPolicy: "queue",
  state: { jid: "", voiceReply: false },
  context(state) {
    return { state, socket: getRuntime().socket };
  },
  routes: [
    POST("/whatsapp/bootstrap", async (_request, { from }) => {
      const runtime = getRuntime();
      runtime.from = from;
      const queued = runtime.queue.splice(0);
      for (const message of queued) {
        try {
          await dispatchMessage(runtime, message);
        } catch (error) {
          console.error("[whatsapp] failed to dispatch a queued message", error);
          if (runtime.socket !== null) {
            await sendText(
              runtime.socket,
              message.jid,
              "I could not start that task. Please try again.",
            );
          }
        }
      }
      return new Response("ok");
    }),
  ],
  events: {
    async "turn.started"(_event, channelContext) {
      if (channelContext.state.jid !== "") {
        const mode = takeWhatsAppReplyMode(
          getRuntime().replyModes,
          channelContext.state.jid,
          channelContext.state.voiceReply ? "voice" : "text",
        );
        getRuntime().activeReplyModes.set(channelContext.state.jid, mode);
      }
      if (channelContext.socket !== null && channelContext.state.jid !== "") {
        await sendTyping(channelContext.socket, channelContext.state.jid, "composing");
      }
    },
    async "actions.requested"(_event, channelContext) {
      if (channelContext.socket !== null && channelContext.state.jid !== "") {
        await sendTyping(channelContext.socket, channelContext.state.jid, "composing");
      }
    },
    async "input.requested"(event, channelContext) {
      if (channelContext.socket === null || channelContext.state.jid === "") return;
      for (const request of event.requests) {
        const pendingQueue = getRuntime().pendingInputs.get(channelContext.state.jid) ?? [];
        if (pendingQueue.some((pending) => pending.requestId === request.requestId)) continue;
        pendingQueue.push({
          allowFreeform: request.allowFreeform ?? request.options?.length === 0,
          options: request.options ?? [],
          requestId: request.requestId,
        });
        getRuntime().pendingInputs.set(channelContext.state.jid, pendingQueue);
        await sendText(
          channelContext.socket,
          channelContext.state.jid,
          renderWhatsAppInputRequest(request),
        );
      }
    },
    async "message.completed"(event, channelContext) {
      if (channelContext.socket === null || channelContext.state.jid === "") return;
      if (!shouldDeliverAssistantMessage(event)) return;
      const runtime = getRuntime();
      const replyMode =
        runtime.activeReplyModes.get(channelContext.state.jid) ??
        (channelContext.state.voiceReply ? "voice" : "text");
      if (replyMode === "voice") {
        const delivery = await deliverWhatsAppVoiceOrText({
          text: event.message,
          sendText: (text) => sendText(channelContext.socket, channelContext.state.jid, text),
          sendVoice: async (audio) => {
            await channelContext.socket.sendMessage(channelContext.state.jid, {
              audio,
              mimetype: "audio/ogg; codecs=opus",
              ptt: true,
            });
          },
        });
        if (delivery.kind === "text") {
          console.error("[whatsapp] voice reply failed; sent text instead", delivery.error);
        }
        return;
      }
      await sendText(channelContext.socket, channelContext.state.jid, event.message);
    },
    async "session.waiting"(_event, channelContext, sessionContext) {
      const runtime = getRuntime();
      runtime.failedSessions.delete(sessionContext.session.id);
      if (!runtime.pendingInputs.has(channelContext.state.jid)) {
        runtime.activeReplyModes.delete(channelContext.state.jid);
      }
      if (channelContext.socket !== null && channelContext.state.jid !== "") {
        await sendTyping(channelContext.socket, channelContext.state.jid, "paused");
      }
    },
    async "turn.failed"(_event, channelContext, sessionContext) {
      const runtime = getRuntime();
      runtime.pendingInputs.delete(channelContext.state.jid);
      runtime.activeReplyModes.delete(channelContext.state.jid);
      if (
        channelContext.socket === null ||
        channelContext.state.jid === "" ||
        runtime.failedSessions.has(sessionContext.session.id)
      ) {
        return;
      }
      runtime.failedSessions.add(sessionContext.session.id);
      await sendText(
        channelContext.socket,
        channelContext.state.jid,
        "That task failed. Please try again.",
      );
    },
    async "session.failed"(event, channelContext) {
      const runtime = getRuntime();
      runtime.pendingInputs.delete(channelContext.state.jid);
      runtime.activeReplyModes.delete(channelContext.state.jid);
      if (
        channelContext.socket === null ||
        channelContext.state.jid === "" ||
        runtime.failedSessions.has(event.sessionId)
      ) {
        return;
      }
      runtime.failedSessions.add(event.sessionId);
      await sendText(
        channelContext.socket,
        channelContext.state.jid,
        "This session failed. Send /reset to start again.",
      );
    },
  } satisfies ChannelEvents<WhatsAppChannelContext>,
});

if (config.enabled) {
  void startSocket(getRuntime(), config).catch(() => undefined);
}

export default channel;
