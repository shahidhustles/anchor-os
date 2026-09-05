import { afterEach, expect, test } from "bun:test";
import { generateText } from "ai";

import { createOpenCodeModel, OPENCODE_MODEL_OPTIONS } from "./opencode-model";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENCODE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = originalApiKey;
});

test("serializes the OpenCode Responses request contract", async () => {
  process.env.OPENCODE_API_KEY = "verification-only";
  let request: { body: Record<string, unknown>; headers: Headers; url: string } | null =
    null;

  globalThis.fetch = (async (input, init) => {
    request = {
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      headers: new Headers(init?.headers),
      url: String(input),
    };
    throw new Error("intentional verification stop");
  }) as typeof fetch;

  await expect(
    generateText({
      model: createOpenCodeModel("chat-verification"),
      prompt: "hello",
      ...OPENCODE_MODEL_OPTIONS,
    }),
  ).rejects.toThrow("intentional verification stop");

  expect(request).not.toBeNull();
  expect(request!.url).toBe("https://opencode.ai/zen/go/v1/responses");
  expect(request!.headers.get("x-opencode-client")).toBe("anchor-os");
  expect(request!.headers.get("x-opencode-session")).toBe("chat-verification");
  expect(request!.body).toMatchObject({
    include: ["reasoning.encrypted_content"],
    model: "muse-spark-1.3-contributor",
    reasoning: { effort: "xhigh", summary: "detailed" },
    store: false,
  });
});
