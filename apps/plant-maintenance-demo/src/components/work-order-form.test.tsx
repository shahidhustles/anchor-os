import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToString } from "react-dom/server";

import { PRIORITIES, SEED_ASSETS, TEAMS, WORK_ORDER_STATUSES } from "../data/seed";
import { WorkOrderForm } from "./work-order-form";

test("renders every required field with a visible label and stable id", () => {
  const html = renderToString(<WorkOrderForm assets={[...SEED_ASSETS]} />);

  for (const field of [
    "wo-assetId",
    "wo-title",
    "wo-description",
    "wo-priority",
    "wo-assignedTeam",
    "wo-status",
  ]) {
    assert.match(html, new RegExp(`for="${field}"`));
    assert.match(html, new RegExp(`id="${field}"`));
  }
  for (const label of ["Asset", "Title", "Description", "Priority", "Assigned team", "Status"]) {
    assert.ok(html.includes(label));
  }
});

test("offers every seeded asset, team, priority, and status as an option", () => {
  const html = renderToString(<WorkOrderForm assets={[...SEED_ASSETS]} />);

  for (const asset of SEED_ASSETS) {
    assert.match(html, new RegExp(`value="${asset.id}"`));
  }
  for (const team of TEAMS) {
    assert.ok(html.includes(team.replace(/&/g, "&amp;")));
  }
  for (const priority of PRIORITIES) {
    assert.match(html, new RegExp(`value="${priority}"`));
  }
  for (const status of WORK_ORDER_STATUSES) {
    assert.match(html, new RegExp(`value="${status}"`));
  }
});

test("starts with an empty form so no data is pre-filled", () => {
  const html = renderToString(<WorkOrderForm assets={[...SEED_ASSETS]} />);

  assert.doesNotMatch(html, /name="title"[^>]*value="[^"]+"/);
  assert.doesNotMatch(html, /name="assetId"[^>]*value="[^"]+"/);
});

test("cancel is a plain link that cannot submit or mutate data", () => {
  const html = renderToString(<WorkOrderForm assets={[...SEED_ASSETS]} />);

  assert.match(html, /<a[^>]*href="\/work-orders"[^>]*>Cancel<\/a>/);
  assert.doesNotMatch(html, /<button[^>]*type="submit"[^>]*>Cancel/);
  assert.match(html, /Save work order/);
});
