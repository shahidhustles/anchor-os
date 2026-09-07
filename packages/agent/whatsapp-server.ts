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
import QRCode from "qrcode";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  disconnectStatusCode,
  enqueueWhatsAppTask,
  isAllowedWhatsAppJid,
  isAllowedWhatsAppSender,
  isExpectedWhatsAppReceiver,
  markWhatsAppListenersAttached,
  parseWhatsAppBridgeOutbound,
  readWhatsAppConfig,
  shouldReconnectWhatsApp,
  splitWhatsAppText,
  whatsappContinuationAddress,
  whatsappSocketUrlFromEveRegistry,
  type WhatsAppBridgeInbound,
  type WhatsAppSerialQueue,
} from "./agent/lib/whatsapp";
import {
  deliverWhatsAppVoiceOrText,
  prepareWhatsAppVoiceMessage,
  WHATSAPP_VOICE_TRANSCRIPTION_FAILURE_MESSAGE,
  type PreparedVoiceMessage,
} from "./agent/lib/whatsapp-voice";

type AdapterRuntime = {
  bridgeQueue: WhatsAppBridgeInbound[];
  bridgeReconnectTimer: ReturnType<typeof setTimeout> | null;
  bridgeSocket: WebSocket | null;
  deliveryQueue: WhatsAppSerialQueue;
  inboundQueue: WhatsAppSerialQueue;
  listenerSockets: WeakSet<object>;
  receiverVerified: boolean;
  socket: WASocket | null;
  socketReconnectTimer: ReturnType<typeof setTimeout> | null;
  starting: Promise<WASocket> | null;
};

const config = readWhatsAppConfig();
const runtime: AdapterRuntime = {
  bridgeQueue: [],
  bridgeReconnectTimer: null,
  bridgeSocket: null,
  deliveryQueue: { tail: Promise.resolve() },
  inboundQueue: { tail: Promise.resolve() },
  listenerSockets: new WeakSet(),
  receiverVerified: false,
  socket: null,
  socketReconnectTimer: null,
  starting: null,
};

async function sendText(socket: WASocket, jid: string, text: string): Promise<void> {
  for (const part of splitWhatsAppText(text)) {
    await socket.sendMessage(jid, { text: part });
  }
}

async function sendTyping(socket: WASocket, jid: string, state: "composing" | "paused") {
  try {
    await socket.sendPresenceUpdate(state, jid);
  } catch {
    // Presence is best-effort and must not interrupt a task or its final reply.
  }
}

function flushBridgeQueue(): void {
  const socket = runtime.bridgeSocket;
  if (socket === null || socket.readyState !== WebSocket.OPEN) return;
  while (runtime.bridgeQueue.length > 0) {
    const message = runtime.bridgeQueue[0];
    if (message === undefined) return;
    try {
      socket.send(JSON.stringify(message));
      runtime.bridgeQueue.shift();
    } catch {
      return;
    }
  }
}

function sendToEve(message: WhatsAppBridgeInbound): void {
  runtime.bridgeQueue.push(message);
  flushBridgeQueue();
}

async function handleEveMessage(value: unknown): Promise<void> {
  const message = parseWhatsAppBridgeOutbound(value);
  const socket = runtime.socket;
  if (message === null || socket === null || !runtime.receiverVerified) return;
  if (!isAllowedWhatsAppJid(message.jid, config.allowedSender)) return;

  if (message.kind === "presence") {
    await sendTyping(socket, message.jid, message.state);
    return;
  }
  if (message.kind === "voice") {
    const delivery = await deliverWhatsAppVoiceOrText({
      text: message.text,
      sendText: (text) => sendText(socket, message.jid, text),
      sendVoice: async (audio) => {
        await socket.sendMessage(message.jid, {
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
  await sendText(socket, message.jid, message.text);
}

function scheduleBridgeReconnect(): void {
  if (runtime.bridgeReconnectTimer !== null) return;
  runtime.bridgeReconnectTimer = setTimeout(() => {
    runtime.bridgeReconnectTimer = null;
    void connectBridge();
  }, 1_000);
}

async function discoverEveSocketUrl(): Promise<string> {
  if (config.eveSocketUrl !== null) return config.eveSocketUrl;
  try {
    const agentRoot = fileURLToPath(new URL(".", import.meta.url));
    const registry = JSON.parse(
      await readFile(resolve(agentRoot, ".eve", "next-dev-server.json"), "utf8"),
    );
    const discovered = whatsappSocketUrlFromEveRegistry(registry);
    if (discovered !== null) return discovered;
  } catch {
    // The normal web command may still be starting. The retry loop reads the registry again.
  }
  return "ws://127.0.0.1:2000/whatsapp/socket";
}

async function connectBridge(): Promise<void> {
  const current = runtime.bridgeSocket;
  if (
    current !== null &&
    (current.readyState === WebSocket.CONNECTING || current.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const eveSocketUrl = await discoverEveSocketUrl();
  if (runtime.bridgeSocket !== current) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(eveSocketUrl);
  } catch {
    scheduleBridgeReconnect();
    return;
  }
  runtime.bridgeSocket = socket;
  socket.addEventListener("open", () => {
    console.info(`[whatsapp] connected to Eve at ${eveSocketUrl}`);
    flushBridgeQueue();
  });
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    try {
      void enqueueWhatsAppTask(runtime.deliveryQueue, async () => {
        await handleEveMessage(JSON.parse(event.data));
      }).catch((error: unknown) => {
        console.error("[whatsapp] could not deliver Eve output", error);
      });
    } catch (error) {
      console.error("[whatsapp] ignored an invalid Eve message", error);
    }
  });
  socket.addEventListener("close", () => {
    if (runtime.bridgeSocket === socket) runtime.bridgeSocket = null;
    console.info("[whatsapp] Eve disconnected; retrying...");
    scheduleBridgeReconnect();
  });
  socket.addEventListener("error", () => {
    socket.close();
  });
}

async function handleInboundMessage(message: WAMessage): Promise<void> {
  if (!runtime.receiverVerified || message.key.fromMe === true) return;
  if (!isAllowedWhatsAppSender(message.key, config.allowedSender)) return;

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
  if (type !== "audioMessage" && (text == null || text.trim() === "")) return;

  const socket = runtime.socket;
  if (socket === null) return;
  try {
    await socket.readMessages([message.key]);
  } catch {
    // A read receipt is helpful but does not affect delivery.
  }

  await sendTyping(socket, jid, "composing");
  if (type === "audioMessage") {
    let prepared: PreparedVoiceMessage;
    try {
      const audio = await downloadMediaMessage(
        message,
        "buffer",
        {},
        { logger: socket.logger, reuploadRequest: socket.updateMediaMessage },
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
    sendToEve({ kind: "message", jid, replyMode: "voice", text: prepared.text });
    return;
  }

  sendToEve({ kind: "message", jid, replyMode: "text", text: text ?? "" });
}

function attachSocketListeners(socket: WASocket): void {
  if (!markWhatsAppListenersAttached(runtime.listenerSockets, socket)) return;

  socket.ev.on("messages.upsert", (event: BaileysEventMap["messages.upsert"]) => {
    if (event.type !== "notify") return;
    for (const message of event.messages) {
      void enqueueWhatsAppTask(runtime.inboundQueue, async () => {
        try {
          await handleInboundMessage(message);
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
        config.receivingNumber,
      );
      if (!runtime.receiverVerified) {
        console.error(
          `[whatsapp] linked account does not match configured receiver ${config.receivingNumber}`,
        );
        process.exitCode = 1;
        socket.end(new Error("Unexpected WhatsApp receiver account"));
        setTimeout(() => process.exit(1), 100);
        return;
      }
      console.info("[whatsapp] connected");
      return;
    }

    if (update.connection !== "close" || runtime.socket !== socket) return;
    const statusCode = disconnectStatusCode(update.lastDisconnect?.error);
    runtime.socket = null;
    runtime.starting = null;
    runtime.receiverVerified = false;
    const reconnect =
      process.exitCode !== 1 &&
      shouldReconnectWhatsApp(statusCode, [
        DisconnectReason.loggedOut,
        DisconnectReason.connectionReplaced,
      ]);
    console.error(`[whatsapp] disconnected with status ${statusCode ?? "unknown"}`);
    if (reconnect && runtime.socketReconnectTimer === null) {
      runtime.socketReconnectTimer = setTimeout(() => {
        runtime.socketReconnectTimer = null;
        void startSocket().catch(() => undefined);
      }, 1_000);
    }
  });
}

async function startSocket(): Promise<WASocket> {
  if (runtime.socket !== null) return runtime.socket;
  if (runtime.starting !== null) return runtime.starting;

  runtime.starting = (async () => {
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Anchor OS"),
      markOnlineOnConnect: false,
    });
    runtime.socket = socket;
    socket.ev.on("creds.update", saveCreds);
    attachSocketListeners(socket);
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

console.info("[whatsapp] starting standalone adapter");
void connectBridge();
await startSocket();
