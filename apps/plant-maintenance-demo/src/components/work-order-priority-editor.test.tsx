import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { PRIORITIES } from "../data/seed";
import { WorkOrderPriorityEditor } from "./work-order-priority-editor";

test("renders a labeled priority selector and explicit save action", () => {
  const html = renderToString(<WorkOrderPriorityEditor workOrderId="WO-1042" priority="Medium" />);

  assert.match(html, /for="work-order-priority"[^>]*>Change priority/);
  assert.match(html, /id="work-order-priority"/);
  assert.match(html, /name="priority"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Save priority<\/button>/);
  for (const priority of PRIORITIES) {
    assert.match(html, new RegExp(`value="${priority}"`));
  }
  assert.match(html, /value="Medium" selected=""/);
});
