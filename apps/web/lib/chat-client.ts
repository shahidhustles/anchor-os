import { isAnchorModelId, type AnchorModelId } from "@anchor-os/agent/model-catalog";
import {
  sanitizeChatMessages,
  sanitizeStreamEvent,
  type SanitizedChatMessage,
} from "./chat-sanitizer";
import type { ChatSessionCursor, ChatThread, ChatTurnSnapshot } from "./chat-types";
import type { MessageStreamEvent } from "eve/client";

export class ChatClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatClientError";
    this.status = status;
  }
}

export type ChatThreadPatchInput = {
  readonly title?: string;
  readonly modelId?: AnchorModelId;
  readonly session?: ChatSessionCursor | null;
  readonly archived?: boolean;
};

export type LoadedChat = {
  readonly thread: ChatThread;
  readonly events: readonly MessageStreamEvent[];
  readonly messages: readonly SanitizedChatMessage[];
};

const CHATS_API = "/api/chats";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listChats(): Promise<readonly ChatThread[]> {
  const payload: unknown = await request("GET", CHATS_API);
  if (!Array.isArray(payload)) {
    throw new ChatClientError("chat list response must be an array", 500);
  }
  return payload.map(parseChatThread);
}

export async function createChat(): Promise<ChatThread> {
  const payload: unknown = await request("POST", CHATS_API, "{}");
  return parseChatThread(payload);
}

export async function loadChat(chatId: string): Promise<LoadedChat> {
  const payload: unknown = await request("GET", `${CHATS_API}/${encodeURIComponent(chatId)}`);
  return parseLoadedChat(payload);
}

export async function updateChat(chatId: string, patch: ChatThreadPatchInput): Promise<ChatThread> {
  const payload: unknown = await request(
    "PATCH",
    `${CHATS_API}/${encodeURIComponent(chatId)}`,
    JSON.stringify(patch),
  );
  return parseChatThread(payload);
}

export function archiveChat(chatId: string): Promise<ChatThread> {
  return updateChat(chatId, { archived: true });
}

export async function savePendingChatMessage(
  chatId: string,
  message: string | readonly unknown[],
): Promise<void> {
  await request(
    "POST",
    `${CHATS_API}/${encodeURIComponent(chatId)}/messages/pending`,
    JSON.stringify({ message }),
  );
}

export async function saveChatEvents(
  chatId: string,
  sessionId: string,
  events: readonly unknown[],
): Promise<void> {
  await request(
    "POST",
    `${CHATS_API}/${encodeURIComponent(chatId)}/events`,
    JSON.stringify({ sessionId, events: [...events] }),
  );
}

export async function saveChatSnapshot(chatId: string, snapshot: ChatTurnSnapshot): Promise<void> {
  await request(
    "POST",
    `${CHATS_API}/${encodeURIComponent(chatId)}/snapshot`,
    JSON.stringify({
      session: snapshot.session,
      events: [...snapshot.events],
      messages: [...snapshot.messages],
    }),
  );
}

async function request(method: string, path: string, body?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
    });
  } catch (cause: unknown) {
    throw new ChatClientError(`chat request to ${path} failed: ${stringifyCause(cause)}`, 0);
  }
  if (!response.ok) {
    throw new ChatClientError(await responseErrorMessage(response), response.status);
  }
  return response.json();
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload["error"] === "string") {
      return payload["error"];
    }
  } catch {
    // not JSON; fall through to the status-only message
  }
  return `chat request failed with status ${response.status}`;
}

function parseChatThread(value: unknown): ChatThread {
  if (!isRecord(value)) {
    throw new ChatClientError("chat response must be an object", 500);
  }
  const id = requireString(value["id"], "id");
  if (!UUID_PATTERN.test(id)) {
    throw new ChatClientError("chat response id must be a UUID", 500);
  }
  const modelId = requireString(value["modelId"], "modelId");
  if (!isAnchorModelId(modelId)) {
    throw new ChatClientError(
      `chat response modelId "${modelId}" is not a known anchor model`,
      500,
    );
  }
  return {
    id,
    title: requireString(value["title"], "title"),
    modelId,
    eveSessionId: requireNullableString(value["eveSessionId"], "eveSessionId"),
    eveStreamIndex: requireNonNegativeInteger(value["eveStreamIndex"], "eveStreamIndex"),
    lastMessageAt: requireNullableString(value["lastMessageAt"], "lastMessageAt"),
    archivedAt: requireNullableString(value["archivedAt"], "archivedAt"),
    createdAt: requireString(value["createdAt"], "createdAt"),
    updatedAt: requireString(value["updatedAt"], "updatedAt"),
  };
}

function parseLoadedChat(value: unknown): LoadedChat {
  if (!isRecord(value)) {
    throw new ChatClientError("chat history response must be an object", 500);
  }
  const events = value["events"];
  const messages = value["messages"];
  if (!Array.isArray(events)) {
    throw new ChatClientError("chat history response events must be an array", 500);
  }
  if (!Array.isArray(messages)) {
    throw new ChatClientError("chat history response messages must be an array", 500);
  }
  const sanitizedEvents = events.map(sanitizeStreamEvent).filter((event) => event !== null);
  if (sanitizedEvents.length !== events.length) {
    throw new ChatClientError("chat history response contains an invalid event", 500);
  }
  return {
    thread: parseChatThread(value["thread"]),
    events: sanitizedEvents as readonly MessageStreamEvent[],
    messages: sanitizeChatMessages(messages),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChatClientError(`chat response field "${field}" must be a non-empty string`, 500);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireString(value, field);
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ChatClientError(`chat response field "${field}" must be a non-negative integer`, 500);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
