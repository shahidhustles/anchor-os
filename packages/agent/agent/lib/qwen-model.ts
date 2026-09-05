import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { ANCHOR_MODEL_IDS } from "../../model-catalog";

export const QWEN_DEFAULT_BASE_URL =
  "https://casinos-maintains-comfort-redhead.trycloudflare.com/v1";
export const QWEN_DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768;

function requiredQwenApiKey() {
  const apiKey = process.env.QWEN_API_KEY;
  if (apiKey) return apiKey;

  throw new Error(
    "QWEN_API_KEY is required. Add it to apps/web/.env.local before using the Qwen model.",
  );
}

export function qwenContextWindowTokens() {
  const configured = process.env.QWEN_CONTEXT_WINDOW_TOKENS;
  if (configured === undefined) return QWEN_DEFAULT_CONTEXT_WINDOW_TOKENS;

  const tokens = Number(configured);
  if (Number.isSafeInteger(tokens) && tokens > 0) return tokens;

  throw new Error("QWEN_CONTEXT_WINDOW_TOKENS must be a positive integer.");
}

export function createQwenModel() {
  const qwen = createOpenAICompatible({
    name: "anchor-qwen",
    baseURL: process.env.QWEN_BASE_URL ?? QWEN_DEFAULT_BASE_URL,
    apiKey: requiredQwenApiKey(),
    includeUsage: true,
    transformRequestBody: (body) => ({
      ...body,
      chat_template_kwargs: {
        reasoning_effort: "xhigh",
      },
    }),
  });

  return qwen.chatModel(ANCHOR_MODEL_IDS.qwen);
}
