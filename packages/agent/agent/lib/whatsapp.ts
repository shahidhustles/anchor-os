import type { BrowserControlStatusView } from "@anchor-os/browser-control/types";

import { BROWSER_CONTROL_AUTH_ATTRIBUTE } from "./browser-control";

export const DEFAULT_WHATSAPP_ALLOWED_SENDER = "917028546994";
export const DEFAULT_WHATSAPP_RECEIVING_NUMBER = "917276411669";
export const WHATSAPP_BROWSER_UNAVAILABLE_MESSAGE =
  "Browser control is off or unavailable. Open Anchor OS and enable Browser control, then send the task again.";

const WHATSAPP_TEXT_LIMIT = 65_536;

export type WhatsAppConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly allowedSender: string;
      readonly authDir: string;
      readonly receivingNumber: string;
    };

export type WhatsAppMessageKey = {
  readonly remoteJid?: string | null;
  readonly remoteJidAlt?: string | null;
};

export type WhatsAppPendingInput = {
  readonly allowFreeform: boolean;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly requestId: string;
};

export type WhatsAppInputResolution =
  | { readonly kind: "invalid-option"; readonly optionCount: number }
  | {
      readonly kind: "response";
      readonly response:
        | { readonly requestId: string; readonly optionId: string }
        | { readonly requestId: string; readonly text: string };
    };

export type WhatsAppSerialQueue = { tail: Promise<void> };

export type WhatsAppReplyMode = "text" | "voice";

export function normalizePhoneNumber(value: string): string {
  const address = value.split("@")[0] ?? "";
  const localPart = address.split(":")[0] ?? "";
  return localPart.replace(/\D/g, "");
}

export function readWhatsAppConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppConfig {
  if (env.ANCHOR_WHATSAPP_ENABLED !== "1") return { enabled: false };

  const allowedSender = normalizePhoneNumber(
    env.ANCHOR_WHATSAPP_ALLOWED_SENDER ?? DEFAULT_WHATSAPP_ALLOWED_SENDER,
  );
  const receivingNumber = normalizePhoneNumber(
    env.ANCHOR_WHATSAPP_RECEIVING_NUMBER ?? DEFAULT_WHATSAPP_RECEIVING_NUMBER,
  );
  if (allowedSender === "") {
    throw new Error("ANCHOR_WHATSAPP_ALLOWED_SENDER must contain a phone number");
  }
  if (receivingNumber === "") {
    throw new Error("ANCHOR_WHATSAPP_RECEIVING_NUMBER must contain a phone number");
  }

  return {
    enabled: true,
    allowedSender,
    authDir: env.ANCHOR_WHATSAPP_AUTH_DIR?.trim() || "./auth_info_baileys",
    receivingNumber,
  };
}

export function isExpectedWhatsAppReceiver(
  linkedPhoneNumber: string | null | undefined,
  expectedPhoneNumber: string,
): boolean {
  return (
    typeof linkedPhoneNumber === "string" &&
    normalizePhoneNumber(linkedPhoneNumber) === normalizePhoneNumber(expectedPhoneNumber)
  );
}

export function phoneJidForMessage(key: WhatsAppMessageKey): string | null {
  for (const jid of [key.remoteJid, key.remoteJidAlt]) {
    if (typeof jid === "string" && jid.endsWith("@s.whatsapp.net")) return jid;
  }
  return null;
}

export function isAllowedWhatsAppSender(key: WhatsAppMessageKey, allowedSender: string): boolean {
  const jid = phoneJidForMessage(key);
  return jid !== null && normalizePhoneNumber(jid) === normalizePhoneNumber(allowedSender);
}

export function whatsappContinuationAddress(key: WhatsAppMessageKey): string | null {
  return phoneJidForMessage(key);
}

export function whatsappUserAuth(phoneNumber: string) {
  const normalized = normalizePhoneNumber(phoneNumber);
  return {
    attributes: { [BROWSER_CONTROL_AUTH_ATTRIBUTE]: "on" },
    authenticator: "whatsapp-demo",
    principalId: `whatsapp:${normalized}`,
    principalType: "user",
  } as const;
}

export function canDispatchBrowserTask(status: BrowserControlStatusView): boolean {
  return status.status === "on";
}

export function isResetCommand(text: string): boolean {
  return text.trim().toLowerCase() === "/reset";
}

export function shouldDeliverAssistantMessage(input: {
  readonly finishReason: string | undefined;
  readonly message: string | null | undefined;
}): input is { readonly finishReason: string | undefined; readonly message: string } {
  return (
    input.finishReason !== "tool-calls" && input.message?.trim() !== "" && input.message != null
  );
}

export function splitWhatsAppText(text: string): string[] {
  if (text.length <= WHATSAPP_TEXT_LIMIT) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += WHATSAPP_TEXT_LIMIT) {
    chunks.push(text.slice(index, index + WHATSAPP_TEXT_LIMIT));
  }
  return chunks;
}

export function renderWhatsAppInputRequest(input: {
  readonly prompt: string;
  readonly options?: readonly { readonly label: string }[];
}): string {
  if (input.options === undefined || input.options.length === 0) return input.prompt;
  const choices = input.options.map((option, index) => `${index + 1}. ${option.label}`);
  return `${input.prompt}\n\n${choices.join("\n")}\n\nReply with a number.`;
}

export function resolveWhatsAppInputResponse(
  pending: WhatsAppPendingInput,
  text: string,
): WhatsAppInputResolution {
  const answer = text.trim();
  if (pending.options.length > 0) {
    const optionNumber = Number(answer);
    if (
      Number.isInteger(optionNumber) &&
      optionNumber >= 1 &&
      optionNumber <= pending.options.length
    ) {
      const option = pending.options[optionNumber - 1];
      if (option === undefined) {
        return { kind: "invalid-option", optionCount: pending.options.length };
      }
      return {
        kind: "response",
        response: {
          requestId: pending.requestId,
          optionId: option.id,
        },
      };
    }
    if (!pending.allowFreeform) {
      return { kind: "invalid-option", optionCount: pending.options.length };
    }
  }
  return {
    kind: "response",
    response: { requestId: pending.requestId, text: answer },
  };
}

export function markWhatsAppListenersAttached(
  attachedSockets: WeakSet<object>,
  socket: object,
): boolean {
  if (attachedSockets.has(socket)) return false;
  attachedSockets.add(socket);
  return true;
}

export function enqueueWhatsAppTask(
  queue: WhatsAppSerialQueue,
  task: () => Promise<void>,
): Promise<void> {
  const result = queue.tail.then(task, task);
  queue.tail = result.catch(() => undefined);
  return result;
}

export function queueWhatsAppReplyMode(
  replyModes: Map<string, WhatsAppReplyMode[]>,
  jid: string,
  mode: WhatsAppReplyMode,
): void {
  const modes = replyModes.get(jid) ?? [];
  modes.push(mode);
  replyModes.set(jid, modes);
}

export function dropLastWhatsAppReplyMode(
  replyModes: Map<string, WhatsAppReplyMode[]>,
  jid: string,
): void {
  const modes = replyModes.get(jid);
  modes?.pop();
  if (modes?.length === 0) replyModes.delete(jid);
}

export function takeWhatsAppReplyMode(
  replyModes: Map<string, WhatsAppReplyMode[]>,
  jid: string,
  fallback: WhatsAppReplyMode,
): WhatsAppReplyMode {
  const modes = replyModes.get(jid);
  const mode = modes?.shift() ?? fallback;
  if (modes?.length === 0) replyModes.delete(jid);
  return mode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function disconnectStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const output = error.output;
  if (isRecord(output) && typeof output.statusCode === "number") return output.statusCode;
  const data = error.data;
  if (isRecord(data) && typeof data.statusCode === "number") return data.statusCode;
  return undefined;
}

export function shouldReconnectWhatsApp(
  statusCode: number | undefined,
  permanentStatusCodes: readonly number[],
): boolean {
  return statusCode === undefined || !permanentStatusCodes.includes(statusCode);
}
