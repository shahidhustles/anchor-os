import { afterEach, expect, test } from "bun:test";
import { generateText } from "ai";

import { ANCHOR_MODEL_IDS } from "../../model-catalog";
import { createOpenCodeModelSelection, type OpenCodeModelId } from "./opencode-model";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENCODE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = originalApiKey;
});

async function captureRequest(modelId: OpenCodeModelId) {
  process.env.OPENCODE_API_KEY = "verification-only";
  let request: { body: Record<string, unknown>; headers: Headers; url: string } | null = null;

  globalThis.fetch = (async (input, init) => {
    request = {
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      url: String(input),
    };
    throw new Error("intentional verification stop");
  }) as typeof fetch;

  const selection = createOpenCodeModelSelection("chat-verification", modelId);

  await expect(
    generateText({ model: selection.model, prompt: "hello", ...selection.modelOptions }),
  ).rejects.toThrow("intentional verification stop");

  expect(request).not.toBeNull();
  expect(request!.headers.get("x-opencode-client")).toBe("anchor-os");
  expect(request!.headers.get("x-opencode-session")).toBe("chat-verification");

  return { request: request!, selection };
}

test("serializes Muse through Responses with its highest reasoning effort", async () => {
  const { request, selection } = await captureRequest(ANCHOR_MODEL_IDS.muse);

  expect(request.url).toBe("https://opencode.ai/zen/v1/responses");
  expect(selection.modelContextWindowTokens).toBe(1_048_576);
  expect(request!.body).toMatchObject({
    include: ["reasoning.encrypted_content"],
    model: "muse-spark-1.3-contributor-free",
    reasoning: { effort: "xhigh", summary: "detailed" },
    store: false,
  });
});

test.each([
  [ANCHOR_MODEL_IDS.mimo, 200_000],
  [ANCHOR_MODEL_IDS.nemotronUltra, 1_000_000],
  [ANCHOR_MODEL_IDS.nemotronLightning, 262_144],
] as const)(
  "serializes the always-reasoning %s Chat Completions contract",
  async (modelId, contextWindowTokens) => {
    const { request, selection } = await captureRequest(modelId);

    expect(request.url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(selection.modelContextWindowTokens).toBe(contextWindowTokens);
    expect(request.body).toMatchObject({ model: modelId });
    expect(request.body).not.toHaveProperty("reasoning_effort");
  },
);

test("enables Ling reasoning through its supported toggle", async () => {
  const { request, selection } = await captureRequest(ANCHOR_MODEL_IDS.ling);

  expect(request.url).toBe("https://opencode.ai/zen/v1/chat/completions");
  expect(selection.modelContextWindowTokens).toBe(262_144);
  expect(request.body).toMatchObject({
    model: "ling-3.0-flash-fin-free",
    reasoning: { enabled: true },
  });
  expect(request.body).not.toHaveProperty("reasoning_effort");
});
