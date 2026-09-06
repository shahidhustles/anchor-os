import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { AppFooter } from "./app-footer";

test("labels the app as a local demonstration system with synthetic data", () => {
  const html = renderToString(<AppFooter />);

  assert.match(html, /local demonstration system/);
  assert.match(html, /synthetic demonstration data/);
  assert.match(html, /no API or automation endpoint/i);
});
