import type { AnchorModelId } from "@anchor-os/agent/model-catalog";
import { isAnchorModelId } from "@anchor-os/agent/model-catalog";
import {
  DEMO_USER_ID,
  ChatValidationError,
  type ChatEventInsert,
  type ChatMessageInsert,
  type ChatMessageStatus,
  type ChatSessionCursor,
  type ChatThread,
  type ChatThreadCreateInput,
  type ChatThreadPatch,
  type ChatThreadRow,
  type ChatThreadUpdate,
  type PositionedChatEvent,
} from "./chat-types";
import type { ChatSupabaseClient } from "./supabase-server";
import type { SanitizedChatMessage, SanitizedStreamEvent } from "./chat-sanitizer";

export class ChatStoreError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatStoreError";
    this.status = status;
  }
}

const EVE_SESSION_ALREADY_BOUND = "that eve session is already bound to another chat";
const EVE_SESSION_MISMATCH = "that eve session does not match this chat";

export type ChatTurnSnapshotInput = {
  readonly session: ChatSessionCursor;
  readonly events: readonly PositionedChatEvent[];
  readonly messages: readonly SanitizedChatMessage[];
};

export type ChatHistory = {
  readonly thread: ChatThread;
  readonly events: readonly SanitizedStreamEvent[];
  readonly messages: readonly SanitizedChatMessage[];
};

export function chatErrorResponse(error: unknown): Response {
  if (error instanceof ChatStoreError || error instanceof ChatValidationError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: "internal server error" }, { status: 500 });
}

export async function listActiveChatThreads(client: ChatSupabaseClient): Promise<ChatThread[]> {
  const { data, error } = await client
    .from("chat_threads")
    .select()
    .eq("user_id", DEMO_USER_ID)
    .is("archived_at", null)
    .order("last_message_at", { ascending: false, nullsFirst: true })
    .order("created_at", { ascending: false });
  if (error !== null) throw chatStoreError("list chat threads", error);
  return data.map(toChatThread);
}

export async function createChatThread(
  client: ChatSupabaseClient,
  input: ChatThreadCreateInput,
): Promise<ChatThread> {
  const { data, error } = await client
    .from("chat_threads")
    .insert({
      user_id: DEMO_USER_ID,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.modelId === undefined ? {} : { model_id: input.modelId }),
    })
    .select()
    .single();
  if (error !== null || data === null) throw chatStoreError("create chat thread", error);
  return toChatThread(data);
}

export async function getChatThread(
  client: ChatSupabaseClient,
  chatId: string,
): Promise<ChatThread | null> {
  const { data, error } = await client
    .from("chat_threads")
    .select()
    .eq("id", chatId)
    .eq("user_id", DEMO_USER_ID)
    .maybeSingle();
  if (error !== null) throw chatStoreError("load chat thread", error);
  return data === null ? null : toChatThread(data);
}

export async function getChatHistory(
  client: ChatSupabaseClient,
  chatId: string,
): Promise<ChatHistory | null> {
  const thread = await getChatThread(client, chatId);
  if (thread === null) return null;

  const [eventsResult, messagesResult] = await Promise.all([
    client
      .from("chat_events")
      .select("event_id, event_type, event_data, emitted_at")
      .eq("thread_id", chatId)
      .order("stream_index", { ascending: true, nullsFirst: false })
      .order("ingestion_order", { ascending: true }),
    client
      .from("chat_messages")
      .select("message_key, role, content, metadata")
      .eq("thread_id", chatId)
      .order("sort_order", { ascending: true }),
  ]);
  if (eventsResult.error !== null) throw chatStoreError("load chat events", eventsResult.error);
  if (messagesResult.error !== null) {
    throw chatStoreError("load chat message projection", messagesResult.error);
  }

  return {
    thread,
    events: eventsResult.data.map((event) => ({
      type: event.event_type,
      data: event.event_data,
      meta: { id: event.event_id, at: event.emitted_at },
    })),
    messages: messagesResult.data.map((message) => ({
      id: message.message_key,
      role: message.role,
      parts: message.content,
      metadata: message.metadata,
    })),
  };
}

export async function updateChatThread(
  client: ChatSupabaseClient,
  chatId: string,
  patch: ChatThreadPatch,
): Promise<ChatThread | null> {
  const { data, error } = await client
    .from("chat_threads")
    .update(toThreadUpdate(patch))
    .eq("id", chatId)
    .eq("user_id", DEMO_USER_ID)
    .select()
    .maybeSingle();
  if (error !== null) throw chatStoreError("update chat thread", error);
  return data === null ? null : toChatThread(data);
}

export async function createPendingChatMessage(
  client: ChatSupabaseClient,
  chatId: string,
  content: readonly unknown[],
): Promise<void> {
  const nextOrder = await nextMessageSortOrder(client, chatId);
  const { error } = await client.from("chat_messages").insert({
    thread_id: chatId,
    message_key: `pending-${crypto.randomUUID()}`,
    role: "user",
    status: "in_progress",
    content: [...content],
    sort_order: nextOrder,
    metadata: {},
  });
  if (error !== null) throw chatStoreError("create pending chat message", error);
  await updateChatThread(client, chatId, { lastMessageAt: new Date().toISOString() });
}

export async function insertChatEvents(
  client: ChatSupabaseClient,
  chatId: string,
  sessionId: string,
  events: readonly SanitizedStreamEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const rows: ChatEventInsert[] = events.map((event) => ({
    event_id: event.meta.id,
    thread_id: chatId,
    eve_session_id: sessionId,
    event_type: event.type,
    event_data: event.data,
    emitted_at: event.meta.at,
  }));
  const { error } = await client
    .from("chat_events")
    .upsert(rows, { onConflict: "event_id", ignoreDuplicates: true });
  if (error !== null) throw chatStoreError("insert chat events", error);
}

export async function saveChatTurnSnapshot(
  client: ChatSupabaseClient,
  chatId: string,
  snapshot: ChatTurnSnapshotInput,
): Promise<void> {
  const thread = await getChatThread(client, chatId);
  if (thread === null) {
    throw new ChatStoreError("chat not found", 404);
  }
  if (thread.eveSessionId !== null && thread.eveSessionId !== snapshot.session.sessionId) {
    throw new ChatStoreError(EVE_SESSION_MISMATCH, 409);
  }

  const { error: clearError } = await client
    .from("chat_events")
    .update({ stream_index: null })
    .eq("eve_session_id", snapshot.session.sessionId);
  if (clearError !== null) throw chatStoreError("clear chat event stream indexes", clearError);

  const eventRows: ChatEventInsert[] = snapshot.events.map((event) => ({
    event_id: event.meta.id,
    thread_id: chatId,
    eve_session_id: snapshot.session.sessionId,
    event_type: event.type,
    event_data: event.data,
    emitted_at: event.meta.at,
    stream_index: event.streamIndex,
  }));
  if (eventRows.length > 0) {
    const { error } = await client
      .from("chat_events")
      .upsert(eventRows, { onConflict: "event_id" });
    if (error !== null) throw chatStoreError("reconcile chat events", error);
  }

  const messageRows = snapshot.messages.map((message, index) =>
    toChatMessageInsert(chatId, message, index),
  );
  const { error: deleteError } = await client
    .from("chat_messages")
    .delete()
    .eq("thread_id", chatId);
  if (deleteError !== null) throw chatStoreError("clear chat message projection", deleteError);
  if (messageRows.length > 0) {
    const { error } = await client.from("chat_messages").insert(messageRows);
    if (error !== null) throw chatStoreError("replace chat message projection", error);
  }

  await updateChatThread(client, chatId, { session: snapshot.session });
}

async function nextMessageSortOrder(client: ChatSupabaseClient, chatId: string): Promise<number> {
  const { data, error } = await client
    .from("chat_messages")
    .select("sort_order")
    .eq("thread_id", chatId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error !== null) throw chatStoreError("read message sort order", error);
  const highest = data[0]?.sort_order;
  return typeof highest === "number" ? highest + 1 : 0;
}

function toChatMessageInsert(
  chatId: string,
  message: SanitizedChatMessage,
  index: number,
): ChatMessageInsert {
  const status = toMessageStatus(message);
  const turnId = message.metadata["turnId"];
  return {
    thread_id: chatId,
    message_key: message.id,
    eve_turn_id: typeof turnId === "string" && turnId.trim() !== "" ? turnId : null,
    role: message.role,
    content: [...message.parts],
    status,
    sort_order: index,
    metadata: message.metadata,
    ...(status === "completed" || status === "failed"
      ? { completed_at: new Date().toISOString() }
      : {}),
  };
}

function toMessageStatus(message: SanitizedChatMessage): ChatMessageStatus {
  const status = message.metadata["status"];
  if (message.role === "user") {
    return status === "failed" ? "failed" : "completed";
  }
  if (status === "complete") return "completed";
  if (status === "failed") return "failed";
  return "in_progress";
}

function toThreadUpdate(patch: ChatThreadPatch): ChatThreadUpdate {
  const update: ChatThreadUpdate = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.modelId !== undefined) update.model_id = patch.modelId;
  if (patch.session !== undefined) {
    update.eve_session_id = patch.session === null ? null : patch.session.sessionId;
    update.eve_stream_index = patch.session === null ? 0 : patch.session.streamIndex;
  }
  if (patch.archived !== undefined) {
    update.archived_at = patch.archived ? new Date().toISOString() : null;
  }
  if (patch.lastMessageAt !== undefined) update.last_message_at = patch.lastMessageAt;
  return update;
}

function toChatThread(row: ChatThreadRow): ChatThread {
  return {
    id: row.id,
    title: row.title,
    modelId: toAnchorModelId(row.model_id),
    eveSessionId: row.eve_session_id,
    eveStreamIndex: row.eve_stream_index,
    lastMessageAt: row.last_message_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAnchorModelId(value: string): AnchorModelId {
  if (!isAnchorModelId(value)) {
    throw new ChatStoreError(`stored model id "${value}" is not a known anchor model`, 500);
  }
  return value;
}

function chatStoreError(action: string, cause: unknown): ChatStoreError {
  if (postgresErrorCode(cause) === "23505") {
    return new ChatStoreError(EVE_SESSION_ALREADY_BOUND, 409);
  }
  return new ChatStoreError(`failed to ${action}`, 500);
}

function postgresErrorCode(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || !("code" in cause)) return null;
  const code: unknown = cause.code;
  return typeof code === "string" ? code : null;
}
