import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeChatMessages, sanitizeStreamEvent, sanitizeUserMessage } from "./chat-sanitizer";

function event(type: string, data: Record<string, unknown>, id = `evt_${type}`): unknown {
  return { type, data, meta: { id, at: "2026-09-05T00:00:00.000Z" } };
}

test("drops reasoning stream events", () => {
  assert.equal(sanitizeStreamEvent(event("reasoning.appended", { reasoningDelta: "hmm" })), null);
  assert.equal(sanitizeStreamEvent(event("reasoning.completed", { reasoning: "hmm" })), null);
});

test("drops malformed events that cannot be deduplicated", () => {
  assert.equal(sanitizeStreamEvent({ type: "turn.completed" }), null);
  assert.equal(
    sanitizeStreamEvent({ type: "turn.completed", meta: { at: "2026-09-05T00:00:00.000Z" } }),
    null,
  );
  assert.equal(sanitizeStreamEvent({ meta: { id: "evt", at: "2026-09-05T00:00:00.000Z" } }), null);
  assert.equal(sanitizeStreamEvent("turn.completed"), null);
});

test("keeps ordinary events with their data and meta intact", () => {
  const source = event("message.appended", {
    messageDelta: "Hello",
    sequence: 1,
    stepIndex: 0,
    turnId: "t1",
  });
  assert.deepEqual(sanitizeStreamEvent(source), {
    type: "message.appended",
    data: { messageDelta: "Hello", sequence: 1, stepIndex: 0, turnId: "t1" },
    meta: { id: "evt_message.appended", at: "2026-09-05T00:00:00.000Z" },
  });
});

test("strips data URLs and base64 payloads nested in event data", () => {
  const longBase64 = `${"QUJD".repeat(400)}==`;
  const sanitized = sanitizeStreamEvent(
    event("action.result", {
      result: {
        callId: "c1",
        output: {
          document: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${longBase64}`,
          bytes: longBase64,
        },
        toolName: "write_file",
      },
    }),
  );
  assert.ok(sanitized !== null);
  const result = (sanitized.data as Record<string, unknown>)["result"] as Record<string, unknown>;
  const output = result["output"] as Record<string, unknown>;
  assert.equal(output["document"], "[data URL stripped]");
  assert.equal(output["bytes"], "[base64 payload stripped]");
});

test("keeps plain long text that is not base64", () => {
  const prose = "The quick brown fox jumps over the lazy dog. ".repeat(40);
  const sanitized = sanitizeStreamEvent(
    event("message.completed", { message: prose, sequence: 1, stepIndex: 0, turnId: "t1" }),
  );
  assert.ok(sanitized !== null);
  assert.equal(sanitized.data?.["message"], prose);
});

test("drops subagent events whose child event is reasoning", () => {
  const wrapper = {
    type: "subagent.event",
    data: {
      callId: "call1",
      subagentName: "researcher",
      event: event("reasoning.appended", { reasoningDelta: "secret" }, "child_1"),
    },
    meta: { id: "wrap_1", at: "2026-09-05T00:00:00.000Z" },
  };
  assert.equal(sanitizeStreamEvent(wrapper), null);
});

test("keeps subagent events with sanitized child events", () => {
  const longBase64 = `${"QUJD".repeat(300)}==`;
  const wrapper = {
    type: "subagent.event",
    data: {
      callId: "call1",
      subagentName: "researcher",
      event: event(
        "message.appended",
        { messageDelta: `data:text/csv;base64,${longBase64}` },
        "child_1",
      ),
    },
    meta: { id: "wrap_1", at: "2026-09-05T00:00:00.000Z" },
  };
  const sanitized = sanitizeStreamEvent(wrapper);
  assert.ok(sanitized !== null);
  const childEvent = (sanitized.data as Record<string, unknown>)["event"] as Record<
    string,
    unknown
  >;
  const child = childEvent["data"] as Record<string, unknown>;
  assert.equal(child["messageDelta"], "[data URL stripped]");
});

test("projection drops reasoning parts and keeps text and tool parts", () => {
  const messages = sanitizeChatMessages([
    {
      id: "msg_1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "hidden", state: "done" },
        { type: "step-start" },
        { type: "text", text: "Answer", state: "done" },
        {
          type: "dynamic-tool",
          toolName: "write_file",
          toolCallId: "c1",
          state: "output-available",
          input: { path: "doc.md" },
          output: { echo: `${"QUJD".repeat(400)}==` },
        },
      ],
      metadata: { status: "complete", turnId: "t1" },
    },
  ]);
  assert.equal(messages.length, 1);
  const message = messages[0];
  assert.equal(message?.id, "msg_1");
  assert.deepEqual(
    message?.parts.map((part) => (part as Record<string, unknown>)["type"]),
    ["step-start", "text", "dynamic-tool"],
  );
  const toolPart = message?.parts[2] as Record<string, unknown>;
  assert.deepEqual(toolPart["output"], { echo: "[base64 payload stripped]" });
  assert.deepEqual(message?.metadata, { status: "complete", turnId: "t1" });
});

test("projection strips data and blob URLs from file parts but keeps remote ones", () => {
  const messages = sanitizeChatMessages([
    {
      id: "msg_u",
      role: "user",
      parts: [
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "a.pdf",
          url: "data:application/pdf;base64,QUJD",
        },
        {
          type: "file",
          mediaType: "text/plain",
          filename: "b.txt",
          url: "https://example.com/b.txt",
        },
        { type: "image", mediaType: "image/png", url: "blob:https://app.local/xyz" },
      ],
    },
  ]);
  assert.equal(messages.length, 1);
  const parts = messages[0]?.parts as Record<string, unknown>[];
  assert.equal("url" in parts[0], false);
  assert.equal(parts[1]?.["url"], "https://example.com/b.txt");
  assert.equal("url" in parts[2], false);
});

test("projection drops messages without id, known role, or parts", () => {
  assert.deepEqual(sanitizeChatMessages([{ id: "", role: "user", parts: [] }]), []);
  assert.deepEqual(sanitizeChatMessages([{ id: "m", role: "system", parts: [] }]), []);
  assert.deepEqual(sanitizeChatMessages([{ id: "m", role: "user", parts: "nope" }]), []);
  assert.deepEqual(sanitizeChatMessages(["nope"]), []);
});

test("projection normalizes missing metadata to an empty object", () => {
  const messages = sanitizeChatMessages([
    { id: "m", role: "user", parts: [{ type: "text", text: "hi" }] },
  ]);
  assert.deepEqual(messages[0]?.metadata, {});
});

test("sanitizeUserMessage turns a string into a single text part", () => {
  assert.deepEqual(sanitizeUserMessage("Hello there"), [{ type: "text", text: "Hello there" }]);
});

test("sanitizeUserMessage strips data URLs typed inside the text", () => {
  const parts = sanitizeUserMessage("See data:text/plain;base64,QUJDREVGRw== attached");
  assert.deepEqual(parts, [{ type: "text", text: "See [data URL stripped] attached" }]);
});

test("sanitizeUserMessage keeps structure and strips reasoning and inline bytes", () => {
  const parts = sanitizeUserMessage([
    { type: "text", text: "Look at this" },
    {
      type: "file",
      mediaType: "application/zip",
      filename: "a.zip",
      url: "data:application/zip;base64,QUJD",
    },
    { type: "reasoning", text: "hidden" },
    "not-a-part",
  ]);
  assert.equal(parts.length, 2);
  const filePart = parts[1] as Record<string, unknown>;
  assert.equal("url" in filePart, false);
  assert.equal(filePart["filename"], "a.zip");
});
