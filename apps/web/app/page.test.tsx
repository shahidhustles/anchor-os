import assert from "node:assert/strict";
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
