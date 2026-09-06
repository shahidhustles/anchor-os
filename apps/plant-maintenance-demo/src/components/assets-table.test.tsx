import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { SEED_ASSETS } from "../data/seed";
import { AssetsTable } from "./assets-table";

test("lists every seeded asset with labeled columns", () => {
  const html = renderToString(
    <AssetsTable assets={[...SEED_ASSETS]} query="" onClearQuery={() => {}} />,
  );

  for (const heading of ["Asset ID", "Name", "Type", "Location", "Status"]) {
    assert.ok(html.includes(heading));
  }
  for (const asset of SEED_ASSETS) {
    assert.ok(html.includes(asset.name));
    assert.match(html, new RegExp(`/assets/${asset.id}`));
  }
});

test("renders a composed empty state with a clear-search action", () => {
  const html = renderToString(
    <AssetsTable assets={[]} query="no-such-pump" onClearQuery={() => {}} />,
  );

  assert.match(html, /No assets match/);
  assert.match(html, /Clear search/);
});
