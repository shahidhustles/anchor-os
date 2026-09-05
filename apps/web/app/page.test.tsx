import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import Home from "./page";

test("renders the model picker with the default model selected", () => {
  const html = renderToString(<Home />);

  assert.match(html, /data-slot="model-selector-trigger"/);
  assert.match(html, /Muse Spark 1\.3 Contributor/);
});

test("renders identical markup across server passes", () => {
  assert.equal(renderToString(<Home />), renderToString(<Home />));
});
