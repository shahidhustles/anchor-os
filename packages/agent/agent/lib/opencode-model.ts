import { createOpenAI, type OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { ANCHOR_MODEL_IDS, type AnchorModelId } from "../../model-catalog";

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

const MUSE_MODEL_OPTIONS = {
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

const LING_MODEL_OPTIONS = {
  providerOptions: {
    openCodeZen: {
      reasoning: { enabled: true },
    },
  },
};

const OPEN_CODE_MODEL_CONFIG = {
  [ANCHOR_MODEL_IDS.muse]: {
    api: "responses",
    contextWindowTokens: 1_048_576,
    modelOptions: MUSE_MODEL_OPTIONS,
  },
  [ANCHOR_MODEL_IDS.mimo]: {
    api: "chat",
    contextWindowTokens: 200_000,
  },
  [ANCHOR_MODEL_IDS.ling]: {
    api: "chat",
    contextWindowTokens: 262_144,
    modelOptions: LING_MODEL_OPTIONS,
  },
  [ANCHOR_MODEL_IDS.nemotronUltra]: {
    api: "chat",
    contextWindowTokens: 1_000_000,
  },
  [ANCHOR_MODEL_IDS.nemotronLightning]: {
    api: "chat",
    contextWindowTokens: 262_144,
  },
} as const;

export type OpenCodeModelId = keyof typeof OPEN_CODE_MODEL_CONFIG;

export function isOpenCodeModelId(modelId: AnchorModelId): modelId is OpenCodeModelId {
  return modelId in OPEN_CODE_MODEL_CONFIG;
}

function requiredOpenCodeApiKey() {
  const apiKey = process.env.OPENCODE_API_KEY;

  if (apiKey) return apiKey;

  throw new Error(
    "OPENCODE_API_KEY is required. Add it to apps/web/.env.local before starting Anchor OS.",
  );
}

function openCodeHeaders(sessionId: string) {
  return {
    "x-opencode-client": "anchor-os",
    "x-opencode-session": sessionId,
  };
}

export function createOpenCodeModelSelection(sessionId: string, modelId: OpenCodeModelId) {
  const config = OPEN_CODE_MODEL_CONFIG[modelId];
  const apiKey = requiredOpenCodeApiKey();

  if (config.api === "responses") {
    const openCode = createOpenAI({
      baseURL: OPENCODE_BASE_URL,
      apiKey,
      headers: openCodeHeaders(sessionId),
    });

    return {
      model: openCode.responses(modelId),
      modelContextWindowTokens: config.contextWindowTokens,
      modelOptions: config.modelOptions,
    };
  }

  const openCode = createOpenAICompatible({
    name: "open-code-zen",
    baseURL: OPENCODE_BASE_URL,
    apiKey,
    headers: openCodeHeaders(sessionId),
    includeUsage: true,
  });

  return {
    model: openCode.chatModel(modelId),
    modelContextWindowTokens: config.contextWindowTokens,
    ...(modelId === ANCHOR_MODEL_IDS.ling ? { modelOptions: LING_MODEL_OPTIONS } : {}),
  };
}
