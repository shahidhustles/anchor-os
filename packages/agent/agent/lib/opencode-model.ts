import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_MODEL_ID = "muse-spark-1.3-contributor";
export const OPENCODE_CONTEXT_WINDOW_TOKENS = 1_048_576;

export const OPENCODE_MODEL_OPTIONS = {
  providerOptions: {
    openai: {
      forceReasoning: true,
      reasoningEffort: "xhigh",
      reasoningSummary: "detailed",
      store: false,
      include: ["reasoning.encrypted_content"],
    } satisfies OpenAIResponsesProviderOptions,
  },
};

export function createOpenCodeModel(sessionId: string) {
  const apiKey = process.env.OPENCODE_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENCODE_API_KEY is required. Add it to apps/web/.env.local before starting Anchor OS.",
    );
  }

  const openCode = createOpenAI({
    baseURL: OPENCODE_BASE_URL,
    apiKey,
    headers: {
      "x-opencode-client": "anchor-os",
      "x-opencode-session": sessionId,
    },
  });

  return openCode.responses(OPENCODE_MODEL_ID);
}
