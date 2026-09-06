import { expect, test } from "bun:test";
import { ANCHOR_MODEL_IDS } from "../../model-catalog";
import { resolveModelId } from "./model-selection";

test("accepts a known model id", () => {
  expect(resolveModelId(ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.qwen);
});

test("falls back to Muse for a missing or unknown model id", () => {
  expect(resolveModelId(undefined)).toBe(ANCHOR_MODEL_IDS.muse);
  expect(resolveModelId("unknown-model")).toBe(ANCHOR_MODEL_IDS.muse);
});

test("keeps the session model when a resumed input response has no model attribute", () => {
  expect(resolveModelId(undefined, ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.qwen);
  expect(resolveModelId("unknown-model", ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.muse);
});
