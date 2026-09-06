import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { SEED_ASSETS, SEED_WORK_ORDERS } from "../data/seed";
import { WorkOrdersTable } from "./work-order-table";

test("lists work orders with labeled columns and newest first", () => {
  const html = renderToString(
    <WorkOrdersTable workOrders={[...SEED_WORK_ORDERS]} assets={[...SEED_ASSETS]} />,
  );

  for (const heading of ["Work order", "Asset", "Priority", "Assigned team", "Status", "Created"]) {
    assert.ok(html.includes(heading));
  }
  assert.match(html, /WO-1042/);
  assert.match(html, /WO-1041/);
  assert.match(html, /Mechanical Maintenance/);
  assert.match(html, /In Progress/);
  assert.ok(html.indexOf("WO-1042") < html.indexOf("WO-1041"));
});

test("highlights the just-created work order row", () => {
  const html = renderToString(
    <WorkOrdersTable
      workOrders={[...SEED_WORK_ORDERS]}
      assets={[...SEED_ASSETS]}
      highlightId="WO-1042"
    />,
  );

  assert.match(html, /border-l-ember/);
});
