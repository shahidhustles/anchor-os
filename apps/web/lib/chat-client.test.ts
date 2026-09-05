import assert from "node:assert/strict";
import { test } from "node:test";

import { ChatClientError, createChat, listChats, updateChat } from "./chat-client";

const THREAD_JSON = {
  id: "3f9d1c9e-8b7a-4c2d-9e1f-0a2b3c4d5e6f",
  title: "New chat",
  modelId: "muse-spark-1.3-contributor",
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
      assert.equal(threads[0]?.modelId, "muse-spark-1.3-contributor");
    },
  );
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

test("listChats rejects malformed thread payloads", async () => {
  await withFetch(
    async () => jsonResponse([{ nope: true }]),
    async () => {
      await assert.rejects(listChats(), (error: unknown) => error instanceof ChatClientError);
    },
  );
});
