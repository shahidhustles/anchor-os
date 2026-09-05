import { isAnchorModelId, type AnchorModelId } from "@anchor-os/agent/model-catalog";
import type { SanitizedStreamEvent } from "./chat-sanitizer";

export const DEMO_USER_ID = "demo";

const MAX_TITLE_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChatValidationError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ChatValidationError";
  }
}

export type ChatThread = {
  readonly id: string;
  readonly title: string;
  readonly modelId: AnchorModelId;
  readonly eveSessionId: string | null;
  readonly eveStreamIndex: number;
  readonly lastMessageAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ChatSessionCursor = {
  readonly sessionId: string;
  readonly streamIndex: number;
};

export type PositionedChatEvent = SanitizedStreamEvent & { readonly streamIndex: number };

export type ChatTurnSnapshot = {
  readonly session: ChatSessionCursor;
  readonly events: readonly unknown[];
  readonly messages: readonly unknown[];
};

export type ChatThreadCreateInput = {
  readonly title?: string;
  readonly modelId?: AnchorModelId;
};

export type ChatThreadPatch = {
  readonly title?: string;
  readonly modelId?: AnchorModelId;
  readonly session?: ChatSessionCursor | null;
  readonly archived?: boolean;
  readonly lastMessageAt?: string | null;
};

export type ChatThreadRow = {
  readonly id: string;
  readonly user_id: string;
  readonly eve_session_id: string | null;
  readonly sandbox_id: string | null;
  readonly title: string;
  readonly model_id: string;
  readonly last_message_at: string | null;
  readonly archived_at: string | null;
  readonly eve_stream_index: number;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ChatThreadInsert = {
  readonly user_id: string;
  readonly eve_session_id?: string | null;
  readonly title?: string;
  readonly model_id?: string;
  readonly last_message_at?: string | null;
  readonly archived_at?: string | null;
  readonly eve_stream_index?: number;
};

export type ChatThreadUpdate = {
  eve_session_id?: string | null;
  title?: string;
  model_id?: string;
  last_message_at?: string | null;
  archived_at?: string | null;
  eve_stream_index?: number;
};

export type ChatDatabase = {
  public: {
    Tables: {
      chat_threads: {
        Row: ChatThreadRow;
        Insert: ChatThreadInsert;
        Update: ChatThreadUpdate;
        Relationships: [];
      };
      chat_events: {
        Row: ChatEventRow;
        Insert: ChatEventInsert;
        Update: ChatEventUpdate;
        Relationships: [];
      };
      chat_messages: {
        Row: ChatMessageRow;
        Insert: ChatMessageInsert;
        Update: ChatMessageUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

export type ChatMessageRole = "assistant" | "user";

export type ChatMessageStatus = "cancelled" | "completed" | "failed" | "in_progress";

export type ChatEventRow = {
  readonly event_id: string;
  readonly thread_id: string;
  readonly eve_session_id: string;
  readonly event_type: string;
  readonly event_data: Record<string, unknown> | null;
  readonly emitted_at: string;
  readonly stream_index: number | null;
  readonly ingestion_order: number;
  readonly created_at: string;
};

export type ChatEventInsert = {
  readonly event_id: string;
  readonly thread_id: string;
  readonly eve_session_id: string;
  readonly event_type: string;
  readonly event_data?: Record<string, unknown> | null;
  readonly emitted_at: string;
  readonly stream_index?: number | null;
};

export type ChatEventUpdate = {
  readonly thread_id?: string;
  readonly eve_session_id?: string;
  readonly event_type?: string;
  readonly event_data?: Record<string, unknown> | null;
  readonly emitted_at?: string;
  readonly stream_index?: number | null;
};

export type ChatMessageRow = {
  readonly id: string;
  readonly thread_id: string;
  readonly message_key: string;
  readonly eve_turn_id: string | null;
  readonly role: ChatMessageRole;
  readonly content: readonly unknown[];
  readonly status: ChatMessageStatus;
  readonly sort_order: number;
  readonly metadata: Record<string, unknown>;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
};

export type ChatMessageInsert = {
  readonly thread_id: string;
  readonly message_key: string;
  readonly eve_turn_id?: string | null;
  readonly role: ChatMessageRole;
  readonly content?: readonly unknown[];
  readonly status?: ChatMessageStatus;
  readonly sort_order: number;
  readonly metadata?: Record<string, unknown>;
  readonly completed_at?: string | null;
};

export type ChatMessageUpdate = {
  readonly message_key?: string;
  readonly eve_turn_id?: string | null;
  readonly role?: ChatMessageRole;
  readonly content?: readonly unknown[];
  readonly status?: ChatMessageStatus;
  readonly sort_order?: number;
  readonly metadata?: Record<string, unknown>;
  readonly completed_at?: string | null;
};

export function isChatThreadId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export async function parseChatRequestBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new ChatValidationError("request body must be valid JSON");
  }
}

export function parseCreateChatThreadInput(body: unknown): ChatThreadCreateInput {
  const record = expectJsonObject(body, "request body");
  const input: { title?: string; modelId?: AnchorModelId } = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === "title") {
      input.title = parseTitle(value);
    } else if (key === "modelId") {
      input.modelId = parseModelId(value);
    } else {
      throw unsupportedField(key, ["title", "modelId"]);
    }
  }
  return input;
}

export function parseChatThreadPatch(body: unknown): ChatThreadPatch {
  const record = expectJsonObject(body, "request body");
  const patch: {
    title?: string;
    modelId?: AnchorModelId;
    session?: ChatSessionCursor | null;
    archived?: boolean;
  } = {};
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (key === "title") {
      patch.title = parseTitle(value);
    } else if (key === "modelId") {
      patch.modelId = parseModelId(value);
    } else if (key === "session") {
      patch.session = value === null ? null : parseSessionCursor(value);
    } else if (key === "archived") {
      if (typeof value !== "boolean") {
        throw new ChatValidationError("archived must be a boolean");
      }
      patch.archived = value;
    } else {
      throw unsupportedField(key, ["title", "modelId", "session", "archived"]);
    }
  }
  if (
    patch.title === undefined &&
    patch.modelId === undefined &&
    patch.session === undefined &&
    patch.archived === undefined
  ) {
    throw new ChatValidationError("body has no supported fields to update");
  }
  return patch;
}

function expectJsonObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChatValidationError(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseTitle(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatValidationError("title must be a string");
  }
  const title = value.trim();
  if (title === "") {
    throw new ChatValidationError("title must not be empty");
  }
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ChatValidationError(`title must be at most ${MAX_TITLE_LENGTH} characters`);
  }
  return title;
}

function parseModelId(value: unknown): AnchorModelId {
  if (typeof value !== "string" || !isAnchorModelId(value)) {
    throw new ChatValidationError("modelId is not a known anchor model");
  }
  return value;
}

function parseSessionCursor(value: unknown): ChatSessionCursor {
  const record = expectJsonObject(value, "session");
  const sessionId = record["sessionId"];
  const streamIndex = record["streamIndex"];
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new ChatValidationError("session.sessionId must be a non-empty string");
  }
  if (typeof streamIndex !== "number" || !Number.isInteger(streamIndex) || streamIndex < 0) {
    throw new ChatValidationError("session.streamIndex must be a non-negative integer");
  }
  return { sessionId: sessionId.trim(), streamIndex };
}

export type PendingMessageBody = {
  readonly message: string | readonly unknown[];
};

export function parsePendingMessageBody(body: unknown): PendingMessageBody {
  const record = expectJsonObject(body, "request body");
  for (const key of Object.keys(record)) {
    if (key !== "message") {
      throw unsupportedField(key, ["message"]);
    }
  }
  const message = record["message"];
  if (typeof message === "string") {
    if (message.trim() === "") {
      throw new ChatValidationError("message must not be empty");
    }
    return { message };
  }
  if (Array.isArray(message)) {
    if (message.length === 0) {
      throw new ChatValidationError("message must not be an empty array");
    }
    return { message };
  }
  throw new ChatValidationError("message must be a string or an array of parts");
}

export type ChatEventBatchBody = {
  readonly sessionId: string;
  readonly events: readonly unknown[];
};

export function parseChatEventBatchBody(body: unknown): ChatEventBatchBody {
  const record = expectJsonObject(body, "request body");
  const sessionId = record["sessionId"];
  const events = record["events"];
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    throw new ChatValidationError("sessionId must be a non-empty string");
  }
  if (!Array.isArray(events)) {
    throw new ChatValidationError("events must be an array");
  }
  return { sessionId: sessionId.trim(), events };
}

export type ChatSnapshotBody = {
  readonly session: ChatSessionCursor;
  readonly events: readonly unknown[];
  readonly messages: readonly unknown[];
};

export function parseChatSnapshotBody(body: unknown): ChatSnapshotBody {
  const record = expectJsonObject(body, "request body");
  const session = record["session"];
  const events = record["events"];
  const messages = record["messages"];
  if (session === undefined) {
    throw new ChatValidationError("session is required");
  }
  if (!Array.isArray(events)) {
    throw new ChatValidationError("events must be an array");
  }
  if (!Array.isArray(messages)) {
    throw new ChatValidationError("messages must be an array");
  }
  return { session: parseSessionCursor(session), events, messages };
}

function unsupportedField(key: string, allowed: readonly string[]): ChatValidationError {
  return new ChatValidationError(`field "${key}" is not supported; allowed: ${allowed.join(", ")}`);
}
