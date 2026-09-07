import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ChatClientError,
  createChat,
  listChats,
  loadChat,
  saveChatEvents,
  saveChatSession,
  saveChatSnapshot,
  updateChat,
} from "./chat-client";

const THREAD_JSON = {
  id: "3f9d1c9e-8b7a-4c2d-9e1f-0a2b3c4d5e6f",
  title: "New chat",
  modelId: "muse-spark-1.3-contributor-free",
  eveSessionId: null,
  eveStreamIndex: 0,
  lastMessageAt: null,
  archivedAt: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withFetch(fetchStub: typeof fetch, run: () => Promise<unknown>): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("createChat posts to /api/chats and parses the thread", async () => {
  let requestPath = "";
  let requestMethod = "";
  let requestBody: string | undefined;

  await withFetch(
    async (input, init) => {
      requestPath = String(input);
      requestMethod = init?.method ?? "GET";
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return jsonResponse(THREAD_JSON);
    },
    async () => {
      const thread = await createChat();
      assert.equal(thread.id, THREAD_JSON.id);
      assert.equal(thread.eveSessionId, null);
      assert.equal(thread.eveStreamIndex, 0);
    },
  );

  assert.equal(requestPath, "/api/chats");
  assert.equal(requestMethod, "POST");
  assert.equal(requestBody, "{}");
});

test("listChats parses a thread list", async () => {
  await withFetch(
    async () => jsonResponse([THREAD_JSON]),
    async () => {
      const threads = await listChats();
      assert.equal(threads.length, 1);
      assert.equal(threads[0]?.modelId, "muse-spark-1.3-contributor-free");
    },
  );
});

test("loadChat fetches saved events and the message projection", async () => {
  const savedThread = { ...THREAD_JSON, eveSessionId: "ses_123", eveStreamIndex: 1 };
  let requestPath = "";

  await withFetch(
    async (input) => {
      requestPath = String(input);
      return jsonResponse({
        thread: savedThread,
        events: [
          {
            type: "session.started",
            data: {},
            meta: { id: "event_1", at: "2026-09-05T00:00:00.000Z" },
          },
        ],
        messages: [
          {
            id: "message_1",
            role: "user",
            parts: [{ type: "text", text: "Remember this" }],
            metadata: {},
          },
        ],
      });
    },
    async () => {
      const chat = await loadChat(THREAD_JSON.id);
      assert.equal(chat.thread.eveSessionId, "ses_123");
      assert.equal(chat.events[0]?.meta.id, "event_1");
      assert.equal(chat.messages[0]?.parts.length, 1);
    },
  );

  assert.equal(requestPath, `/api/chats/${THREAD_JSON.id}`);
});

test("updateChat sends the session cursor patch", async () => {
  let requestPath = "";
  let requestMethod = "";
  let requestBody: string | undefined;

  await withFetch(
    async (input, init) => {
      requestPath = String(input);
      requestMethod = init?.method ?? "GET";
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return jsonResponse({ ...THREAD_JSON, eveSessionId: "ses_123", eveStreamIndex: 3 });
    },
    async () => {
      const thread = await updateChat(THREAD_JSON.id, {
        session: { sessionId: "ses_123", streamIndex: 3 },
      });
      assert.equal(thread.eveSessionId, "ses_123");
      assert.equal(thread.eveStreamIndex, 3);
    },
  );

  assert.equal(requestPath, `/api/chats/${THREAD_JSON.id}`);
  assert.equal(requestMethod, "PATCH");
  assert.deepEqual(JSON.parse(requestBody ?? "{}"), {
    session: { sessionId: "ses_123", streamIndex: 3 },
  });
});

test("updateChat surfaces API error status and message", async () => {
  await withFetch(
    async () => jsonResponse({ error: "that eve session is already bound to another chat" }, 409),
    async () => {
      await assert.rejects(
        updateChat(THREAD_JSON.id, { session: { sessionId: "ses_x", streamIndex: 0 } }),
        (error: unknown) =>
          error instanceof ChatClientError &&
          error.status === 409 &&
          error.message === "that eve session is already bound to another chat",
      );
    },
  );
});

test("retries idempotent event writes without changing their event id", async () => {
  let attempts = 0;
  const event = {
    type: "message.appended",
    data: { messageDelta: "Hello" },
    meta: { id: "event_1", at: "2026-09-05T00:00:00.000Z" },
  };

  await withFetch(
    async (_input, init) => {
      attempts += 1;
      assert.equal(init?.body, JSON.stringify({ sessionId: "ses_123", events: [event] }));
      return attempts === 1
        ? jsonResponse({ error: "temporary failure" }, 503)
        : jsonResponse({ ok: true });
    },
    () => saveChatEvents(THREAD_JSON.id, "ses_123", [event]),
  );

  assert.equal(attempts, 2);
});

test("retries idempotent session cursor writes without changing the cursor", async () => {
  let attempts = 0;
  const session = { sessionId: "ses_123", streamIndex: 3 };

  await withFetch(
    async (_input, init) => {
      attempts += 1;
      assert.equal(init?.body, JSON.stringify({ session }));
      return attempts === 1
        ? jsonResponse({ error: "temporary failure" }, 503)
        : jsonResponse({ ...THREAD_JSON, eveSessionId: "ses_123", eveStreamIndex: 3 });
    },
    () => saveChatSession(THREAD_JSON.id, session),
  );

  assert.equal(attempts, 2);
});

test("retries idempotent snapshot writes with the same session cursor", async () => {
  let attempts = 0;
  const snapshot = {
    session: { sessionId: "ses_123", streamIndex: 3 },
    events: [],
    messages: [],
  };

  await withFetch(
    async (_input, init) => {
      attempts += 1;
      assert.equal(init?.body, JSON.stringify(snapshot));
      return attempts === 1
        ? jsonResponse({ error: "temporary failure" }, 503)
        : jsonResponse({ ok: true });
    },
    () => saveChatSnapshot(THREAD_JSON.id, snapshot),
  );

  assert.equal(attempts, 2);
});

test("listChats rejects malformed thread payloads", async () => {
  await withFetch(
    async () => jsonResponse([{ nope: true }]),
    async () => {
      await assert.rejects(listChats(), (error: unknown) => error instanceof ChatClientError);
    },
  );
});
