import { describe, expect, test } from "bun:test";

import {
  DEFAULT_MODEL_CANDIDATES,
  MODEL_SLUGS,
  MVP_MODEL_PROFILES,
  type ModelSlug,
} from "./profiles";
import { routeModel, routeWithLoadFallback, type RouteEvent } from "./router";

describe("routeModel", () => {
  test("returns only the model slug and confidence", () => {
    const result = routeModel({
      task: "Summarize this short note",
      candidates: DEFAULT_MODEL_CANDIDATES,
    });

    expect(Object.keys(result).sort()).toEqual(["confidence", "model_slug"]);
    expect(DEFAULT_MODEL_CANDIDATES).toContain(result.model_slug);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test.each([
    ["Debug this TypeScript API and run its tests", MODEL_SLUGS.qwenCoder],
    ["Derive this engineering calculation step by step", MODEL_SLUGS.deepSeekReasoning],
    [
      "Create and verify a professional Word inspection report with findings and recommendations",
      MODEL_SLUGS.qwenGeneral,
    ],
    ["Summarize this short note", MODEL_SLUGS.nemotronEfficient],
  ])("routes %s", (task, expectedModel) => {
    expect(routeModel({ task, candidates: DEFAULT_MODEL_CANDIDATES }).model_slug).toBe(
      expectedModel,
    );
  });

  test("keeps text-only models eligible for image tasks served through Vision MCP", () => {
    const candidates: readonly ModelSlug[] = [MODEL_SLUGS.qwenCoder, MODEL_SLUGS.deepSeekReasoning];
    const result = routeModel({
      task: "Analyze this attached image, then solve the calculation",
      candidates,
    });

    expect(candidates).toContain(result.model_slug);
    expect(result.model_slug).toBe(MODEL_SLUGS.deepSeekReasoning);
  });

  test("does not depend on candidate order", () => {
    const task = "Write and verify code for a local API";
    const forwards = routeModel({ task, candidates: DEFAULT_MODEL_CANDIDATES });
    const backwards = routeModel({ task, candidates: [...DEFAULT_MODEL_CANDIDATES].reverse() });

    expect(backwards).toEqual(forwards);
  });

  test.each(["Explain capital allocation strategy", "Contest the vendor invoice"])(
    "does not treat substrings in %s as task signals",
    (task) => {
      expect(routeModel({ task, candidates: DEFAULT_MODEL_CANDIDATES }).model_slug).toBe(
        MODEL_SLUGS.nemotronEfficient,
      );
    },
  );

  test("does not require tool calling for plain writing", () => {
    expect(
      routeModel({
        task: "Write a concise email",
        candidates: DEFAULT_MODEL_CANDIDATES,
      }).model_slug,
    ).toBe(MODEL_SLUGS.nemotronEfficient);
  });

  test("rejects an empty or duplicate candidate list", () => {
    expect(() => routeModel({ task: "Summarize this note", candidates: [] })).toThrow(
      "at least one candidate",
    );
    expect(() =>
      routeModel({
        task: "Summarize this note",
        candidates: [MODEL_SLUGS.qwenGeneral, MODEL_SLUGS.qwenGeneral],
      }),
    ).toThrow("must be unique");
  });

  test("has one complete, normalized profile for every default candidate", () => {
    expect(new Set(DEFAULT_MODEL_CANDIDATES).size).toBe(DEFAULT_MODEL_CANDIDATES.length);
    expect(MVP_MODEL_PROFILES.map((profile) => profile.model_slug)).toEqual([
      ...DEFAULT_MODEL_CANDIDATES,
    ]);

    for (const profile of MVP_MODEL_PROFILES) {
      for (const score of Object.values(profile.capabilities)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
      expect(profile.runtime.tokens_per_second).toBeGreaterThan(0);
      expect(profile.runtime.peak_vram_gb).toBeGreaterThan(0);
      expect(profile.runtime.usable_context).toBeGreaterThan(0);
    }
  });
});

describe("routeWithLoadFallback", () => {
  test("selects the next best model when the first model cannot load", async () => {
    const events: RouteEvent[] = [];
    const attemptedModels: string[] = [];

    const result = await routeWithLoadFallback({
      task: "Debug this TypeScript API and run its tests",
      candidates: DEFAULT_MODEL_CANDIDATES,
      async loadModel(modelSlug) {
        attemptedModels.push(modelSlug);
        if (modelSlug === MODEL_SLUGS.qwenCoder) throw new Error("Model is unavailable");
      },
      onEvent(event) {
        events.push(event);
      },
    });

    expect(attemptedModels[0]).toBe(MODEL_SLUGS.qwenCoder);
    expect(result.model_slug).not.toBe(MODEL_SLUGS.qwenCoder);
    expect(events.some((event) => event.kind === "model_load_failed")).toBe(true);
  });

  test("reports a load error when every local model fails", async () => {
    await expect(
      routeWithLoadFallback({
        task: "Summarize this note",
        candidates: [MODEL_SLUGS.nemotronEfficient],
        async loadModel() {
          throw new Error("GPU is unavailable");
        },
      }),
    ).rejects.toThrow("No candidate model could be loaded");
  });
});
