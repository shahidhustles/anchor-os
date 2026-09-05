import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import Home from "./page";

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

test("keeps saved chat history visible while a workspace cannot resume", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  assert.match(source, /error instanceof ClientError && error\.status === 404/);
  assert.match(source, /data-slot="chat-resume-error"/);
  assert.match(source, /isDisabled: resuming \|\| resumeFailed/);
});
