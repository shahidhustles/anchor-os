import { expect, test } from "bun:test";
import { ANCHOR_MODELS, ANCHOR_MODEL_IDS, normalizeAnchorModelId } from "../../model-catalog";
import { resolveModelId } from "./model-selection";

test("accepts a known model id", () => {
  expect(resolveModelId(ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.qwen);
  expect(resolveModelId(ANCHOR_MODEL_IDS.nemotronUltra)).toBe(ANCHOR_MODEL_IDS.nemotronUltra);
});

test("falls back to Muse for a missing or unknown model id", () => {
  expect(resolveModelId(undefined)).toBe(ANCHOR_MODEL_IDS.muse);
  expect(resolveModelId("unknown-model")).toBe(ANCHOR_MODEL_IDS.muse);
});

test("keeps the session model when a resumed input response has no model attribute", () => {
  expect(resolveModelId(undefined, ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.qwen);
  expect(resolveModelId("unknown-model", ANCHOR_MODEL_IDS.qwen)).toBe(ANCHOR_MODEL_IDS.muse);
});

test("lists the expanded model catalog without provider tier wording", () => {
  expect(ANCHOR_MODELS.map((model) => model.label)).toEqual([
    "Muse Spark 1.3 Contributor",
    "MiMo V2.5",
    "Ling 3.0 Flash Fin",
    "Nemotron 3 Ultra",
    "Nemotron 3.5 Lightning",
    "Qwen 3.8 27B Max",
  ]);
});

test("maps the previous Muse id to the current provider route", () => {
  expect(normalizeAnchorModelId("muse-spark-1.3-contributor")).toBe(ANCHOR_MODEL_IDS.muse);
});
