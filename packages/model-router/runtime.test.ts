import { describe, expect, test } from "bun:test";
import { autoCandidates, registrySchema } from "./registry";
import {
  createLocalRouter,
  eligibleRequest,
  selectSessionModel,
  type RoutingRequest,
  type RoutingResult,
  type RuntimeEvent,
} from "./runtime";
import { MVP_MODEL_PROFILES } from "./profiles";

const request: RoutingRequest = {
  user_task: "Read the inspection report and create a Word approval note",
  candidate_models: MVP_MODEL_PROFILES.map((p) => p.model_slug),
  profiles: [...MVP_MODEL_PROFILES],
  requires_tools: true,
  input_tokens: 1000,
};

async function withServer(
  response: unknown,
  run: (url: string, bodies: unknown[]) => Promise<void>,
) {
  const bodies: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      bodies.push(await req.json());
      return Response.json(response);
    },
  });
  try {
    await run(`http://127.0.0.1:${server.port}/route`, bodies);
  } finally {
    await server.stop(true);
  }
}

describe("learned router client", () => {
  test("passes profiles, filters constraints, and returns only slug/confidence", async () => {
    await withServer({ model_slug: "qwen3.8-27b", confidence: 0.82 }, async (url, bodies) => {
      expect(await createLocalRouter({ url })(request)).toEqual({
        model_slug: "qwen3.8-27b",
        confidence: 0.82,
      });
      expect(bodies).toEqual([eligibleRequest(request)]);
      expect(eligibleRequest(request).candidate_models).not.toContain("gemma-3-27b-it");
    });
  });
  test.each([
    { model_slug: "not-a-candidate", confidence: 0.9 },
    { model_slug: "gemma-3-27b-it", confidence: 0.9 },
    { model_slug: "qwen3.8-27b", confidence: 2 },
    { model_slug: "qwen3.8-27b", confidence: 0.9, requirements: {} },
  ])("invalid output falls back without inference retries", async (value) => {
    await withServer(value, async (url, bodies) => {
      const events: RuntimeEvent[] = [];
      const result = await createLocalRouter({ url, onEvent: (e) => events.push(e) })(request);
      expect(result.confidence).toBe(0);
      expect(eligibleRequest(request).candidate_models).toContain(result.model_slug);
      expect(bodies).toHaveLength(1);
      expect(events[0]?.kind).toBe("router_fallback");
    });
  });
  test("unavailable router uses a configured eligible fallback", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response(null, { status: 503 }),
    });
    try {
      const result = await createLocalRouter({
        url: `http://127.0.0.1:${server.port}/route`,
        fallbackModel: "qwen2.5-coder-14b-instruct",
      })(request);
      expect(result).toEqual({ model_slug: "qwen2.5-coder-14b-instruct", confidence: 0 });
    } finally {
      await server.stop(true);
    }
  });
  test("new anonymous profiles work without extending a slug enum", async () => {
    const profile = { ...MVP_MODEL_PROFILES[1], model_slug: "new_model" };
    await withServer({ model_slug: "new_model", confidence: 0.8 }, async (url) => {
      expect(
        await createLocalRouter({ url })({
          ...request,
          candidate_models: ["new_model"],
          profiles: [profile],
        }),
      ).toEqual({ model_slug: "new_model", confidence: 0.8 });
    });
  });
  test("rejects malformed requests and impossible context before inference", () => {
    expect(() => eligibleRequest({ ...request, profiles: [] })).toThrow();
    expect(() => eligibleRequest({ ...request, input_tokens: 1_000_000 })).toThrow("No compatible");
    expect(() => eligibleRequest({ ...request, user_task: " " })).toThrow();
    expect(() => createLocalRouter({ url: "https://example.com/route" })).toThrow("loopback");
  });
});

describe("session model selection", () => {
  const winner: RoutingResult = { model_slug: "qwen3.8-27b", confidence: 0.8 };
  const base = {
    current: null,
    request,
    autoEnabled: true,
    route: async () => winner,
    loadModel: async (_slug: string) => {},
  };
  test("routes and loads once, then retains the selection across later tasks", async () => {
    const current = await selectSessionModel({ ...base, selection: { mode: "auto" } });
    const result = await selectSessionModel({
      ...base,
      current,
      autoEnabled: false,
      request: { ...request, user_task: "Completely different task" },
      selection: { mode: "auto" },
      route: async () => {
        throw new Error("Must not reroute");
      },
      loadModel: async () => {
        throw new Error("Must not reload");
      },
    });
    expect(result).toBe(current);
  });
  test("manual selection works with Auto disabled and a broken router", async () => {
    const selected = await selectSessionModel({
      ...base,
      autoEnabled: false,
      selection: { mode: "manual", model_slug: "gemma-3-27b-it" },
      route: async () => {
        throw new Error("Must bypass router");
      },
    });
    expect(selected.result.model_slug).toBe("gemma-3-27b-it");
  });
  test("load failure removes the failed candidate and locks the next selection", async () => {
    const attempted: string[] = [];
    const selected = await selectSessionModel({
      ...base,
      selection: { mode: "auto" },
      route: async (input) => ({ model_slug: input.candidate_models[0] ?? "", confidence: 0.7 }),
      loadModel: async (slug) => {
        attempted.push(slug);
        if (slug === winner.model_slug) throw new Error("OOM");
      },
    });
    expect(attempted).toEqual([winner.model_slug, "qwen2.5-coder-14b-instruct"]);
    expect(selected.result.model_slug).toBe("qwen2.5-coder-14b-instruct");
  });
  test("explicit manual change replaces an existing Auto selection", async () => {
    expect(
      (
        await selectSessionModel({
          ...base,
          current: { mode: "auto", result: winner },
          selection: { mode: "manual", model_slug: "qwen2.5-coder-14b-instruct" },
        })
      ).mode,
    ).toBe("manual");
  });
  test("explicit Auto change replaces an existing manual selection", async () => {
    const selected = await selectSessionModel({
      ...base,
      current: {
        mode: "manual",
        result: { model_slug: "qwen2.5-coder-14b-instruct", confidence: 1 },
      },
      selection: { mode: "auto" },
    });
    expect(selected).toEqual({ mode: "auto", result: winner });
  });
  test("no available models and disabled Auto produce actionable errors", async () => {
    await expect(
      selectSessionModel({ ...base, autoEnabled: false, selection: { mode: "auto" } }),
    ).rejects.toThrow("disabled");
    await expect(
      selectSessionModel({
        ...base,
        selection: { mode: "auto" },
        route: async (input) => ({ model_slug: input.candidate_models[0] ?? "", confidence: 0.7 }),
        loadModel: async () => {
          throw new Error("OOM");
        },
      }),
    ).rejects.toThrow("No candidate model");
  });
});

test("registry excludes hosted and disabled entries from Auto", () => {
  const entries = registrySchema.parse(
    MVP_MODEL_PROFILES.map((profile, i) => ({
      profile,
      base_url: "http://127.0.0.1:8000/v1",
      provider: "openai-compatible",
      served_model: profile.model_slug,
      location: i === 0 ? "hosted" : "local",
      auto_eligible: i !== 1,
    })),
  );
  expect(autoCandidates(entries)).toHaveLength(4);
  expect(() => registrySchema.parse([...entries, entries[0]])).toThrow("unique");
});
