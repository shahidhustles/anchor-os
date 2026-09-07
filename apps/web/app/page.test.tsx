import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import Home, { isReusableDraftChat, missingPendingMessages, shouldResumeChat } from "./page";

const THREAD = {
  id: "3f9d1c9e-8b7a-4c2d-9e1f-0a2b3c4d5e6f",
  title: "New chat",
  modelId: "muse-spark-1.3-contributor-free" as const,
  eveSessionId: null,
  eveStreamIndex: 0,
  lastMessageAt: null,
  archivedAt: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
};

test("renders the chat loading state on the server", () => {
  const html = renderToString(<Home />);

  assert.match(html, /data-slot="chat-list-loading"/);
  assert.doesNotMatch(html, /data-slot="model-selector-trigger"/);
});

test("renders identical markup across server passes", () => {
  assert.equal(renderToString(<Home />), renderToString(<Home />));
});

test("explains that chats survive reloads", () => {
  const html = renderToString(<Home />);

  assert.match(html, /Chats are saved and return after reload\./);
  assert.doesNotMatch(html, /Chats reset when this app reloads/);
});

test("renders the browser control switch off on the server", () => {
  const html = renderToString(<Home />);

  assert.match(html, /data-slot="browser-control"/);
  assert.match(html, /role="switch"/);
  assert.match(html, /data-slot="switch-thumb"/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, />Browser control</);
  assert.doesNotMatch(html, /Off\. Eve has no browser access\./);
  assert.doesNotMatch(html, /data-slot="browser-control-status-/);
});

test("mounts the browser control above the chat persistence note", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const toggleIndex = source.indexOf("<BrowserControlToggle");
  const noteIndex = source.indexOf("Chats are saved and return after reload.");

  assert.notEqual(toggleIndex, -1);
  assert.notEqual(noteIndex, -1);
  assert.ok(toggleIndex < noteIndex);
});

test("sends the Eve browser header only while browser control is ready", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  assert.match(source, /browserReadyRef\.current = browserReady/);
  assert.match(
    source,
    /\[BROWSER_CONTROL_HEADER\]: browserControlHeaderValue\(browserReadyRef\.current\)/,
  );
  assert.match(source, /<BrowserControlToggle onReadyChange=\{setBrowserReady\} \/>/);
});

test("keeps saved chat history visible while a workspace cannot resume", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  assert.match(source, /error instanceof ClientError && error\.status === 404/);
  assert.match(source, /data-slot="chat-resume-error"/);
  assert.match(source, /isDisabled: resuming \|\| resumeFailed/);
});

test("keeps the runtime observer callback stable across chat state updates", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const callbackStart = source.indexOf("const updateChat = useCallback");
  const callbackEnd = source.indexOf("const onBindingSettled", callbackStart);
  const callbackSource = source.slice(callbackStart, callbackEnd);

  assert.notEqual(callbackStart, -1);
  assert.notEqual(callbackEnd, -1);
  assert.doesNotMatch(callbackSource, /\bchats\./);
  assert.match(callbackSource, /\[enqueueControlSave\]/);
  assert.match(source, /const chatsRef = useRef\(chats\)/);
});

test("only resumes a chat that has a saved Eve session", () => {
  assert.equal(shouldResumeChat(undefined), false);
  assert.equal(shouldResumeChat({ thread: THREAD, events: [], messages: [] }), false);
  assert.equal(
    shouldResumeChat({
      thread: { ...THREAD, eveSessionId: "ses_123" },
      events: [],
      messages: [],
    }),
    true,
  );
});

test("reuses only a chat that has never accepted a message", () => {
  assert.equal(isReusableDraftChat({ status: "idle", hasAcceptedMessage: false }), true);
  assert.equal(isReusableDraftChat({ status: "running", hasAcceptedMessage: false }), false);
  assert.equal(isReusableDraftChat({ status: "idle", hasAcceptedMessage: true }), false);
});

test("selects a reusable draft before creating another database thread", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const callbackStart = source.indexOf("const spawnChat = useCallback");
  const callbackEnd = source.indexOf("const initialize = useCallback", callbackStart);
  const callbackSource = source.slice(callbackStart, callbackEnd);

  assert.notEqual(callbackStart, -1);
  assert.notEqual(callbackEnd, -1);
  assert.ok(
    callbackSource.indexOf("find(isReusableDraftChat)") < callbackSource.indexOf("createChat()"),
  );
});

test("keeps a pending database message visible until Eve projects it", () => {
  const pending = {
    id: "pending-123",
    role: "user" as const,
    parts: [{ type: "text", text: "Do not lose this" }],
    metadata: {},
  };

  assert.deepEqual(missingPendingMessages([pending], []), [pending]);
  assert.deepEqual(
    missingPendingMessages(
      [pending],
      [{ role: "user", content: [{ type: "text", text: "Do not lose this" }] }],
    ),
    [],
  );
  assert.deepEqual(
    missingPendingMessages(
      [pending, { ...pending, id: "pending-456" }],
      [{ role: "user", content: [{ type: "text", text: "Do not lose this" }] }],
    ).map((message) => message.id),
    ["pending-456"],
  );
});
