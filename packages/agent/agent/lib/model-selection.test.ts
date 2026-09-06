import { expect, test } from "bun:test";
import { ANCHOR_MODEL_IDS } from "../../model-catalog";
import { resolveModelId } from "./model-selection";

test("accepts a known model id", () => {
  expect(resolveModelId(ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.qwen);
  expect(resolveModelId("auto")).toBe("auto");
  expect(resolveModelId("local:qwen2.5-coder-14b-instruct")).toBe(
    "local:qwen2.5-coder-14b-instruct",
  );
});

test("falls back to Muse for a missing or unknown model id", () => {
  expect(resolveModelId(undefined)).toBe(ANCHOR_MODEL_IDS.muse);
  expect(resolveModelId("unknown-model")).toBe(ANCHOR_MODEL_IDS.muse);
});
