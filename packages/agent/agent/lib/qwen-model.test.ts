import { afterEach, expect, test } from "bun:test";
import { generateText } from "ai";

import { createQwenModel } from "./qwen-model";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.QWEN_API_KEY;
const originalBaseUrl = process.env.QWEN_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.QWEN_API_KEY;
  else process.env.QWEN_API_KEY = originalApiKey;
  if (originalBaseUrl === undefined) delete process.env.QWEN_BASE_URL;
  else process.env.QWEN_BASE_URL = originalBaseUrl;
});

test("serializes the self-hosted Qwen request contract", async () => {
  process.env.QWEN_API_KEY = "verification-only";
  process.env.QWEN_BASE_URL = "https://qwen.example.test/v1";
  let request: { body: Record<string, unknown>; headers: Headers; url: string } | null = null;

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
      model: createQwenModel(),
      prompt: "hello",
    }),
  ).rejects.toThrow("intentional verification stop");

  expect(request).not.toBeNull();
  expect(request!.url).toBe("https://qwen.example.test/v1/chat/completions");
  expect(request!.headers.get("authorization")).toBe("Bearer verification-only");
  expect(request!.body).toMatchObject({
    chat_template_kwargs: { reasoning_effort: "xhigh" },
    model: "qwen3.8-27b",
  });
});
