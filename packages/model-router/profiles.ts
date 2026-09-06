export const MODEL_SLUGS = {
  qwenGeneral: "qwen3.8-27b",
  qwenCoder: "qwen2.5-coder-14b-instruct",
  deepSeekReasoning: "deepseek-r1-distill-qwen-14b",
  mistralGeneral: "mistral-small-3.1-24b-instruct",
  gemmaDocument: "gemma-3-27b-it",
  nemotronEfficient: "nemotron-3.5-lightning-30b-a3b",
} as const;

export type ModelSlug = (typeof MODEL_SLUGS)[keyof typeof MODEL_SLUGS];

export type CapabilityScores = Readonly<{
  reasoning: number;
  coding: number;
  tool_use: number;
  document_qa: number;
  structured_output: number;
  instruction_following: number;
  long_context: number;
}>;

export type ModelProfile = Readonly<{
  model_slug: ModelSlug;
  capabilities: CapabilityScores;
  runtime: Readonly<{
    tokens_per_second: number;
    peak_vram_gb: number;
    usable_context: number;
  }>;
  features: Readonly<{
    tool_calling: boolean;
    multimodal: boolean;
  }>;
}>;

export const PROFILE_VERSION = "mvp-static-v1";

export const MVP_MODEL_PROFILES = [
  {
    model_slug: MODEL_SLUGS.qwenGeneral,
    capabilities: {
      reasoning: 0.91,
      coding: 0.88,
      tool_use: 0.94,
      document_qa: 0.93,
      structured_output: 0.94,
      instruction_following: 0.94,
      long_context: 0.96,
    },
    runtime: { tokens_per_second: 18, peak_vram_gb: 54, usable_context: 262_144 },
    features: { tool_calling: true, multimodal: true },
  },
  {
    model_slug: MODEL_SLUGS.qwenCoder,
    capabilities: {
      reasoning: 0.82,
      coding: 0.97,
      tool_use: 0.87,
      document_qa: 0.68,
      structured_output: 0.88,
      instruction_following: 0.85,
      long_context: 0.86,
    },
    runtime: { tokens_per_second: 36, peak_vram_gb: 28, usable_context: 131_072 },
    features: { tool_calling: true, multimodal: false },
  },
  {
    model_slug: MODEL_SLUGS.deepSeekReasoning,
    capabilities: {
      reasoning: 0.97,
      coding: 0.86,
      tool_use: 0.62,
      document_qa: 0.7,
      structured_output: 0.78,
      instruction_following: 0.79,
      long_context: 0.82,
    },
    runtime: { tokens_per_second: 28, peak_vram_gb: 28, usable_context: 65_536 },
    features: { tool_calling: false, multimodal: false },
  },
  {
    model_slug: MODEL_SLUGS.mistralGeneral,
    capabilities: {
      reasoning: 0.86,
      coding: 0.83,
      tool_use: 0.87,
      document_qa: 0.89,
      structured_output: 0.88,
      instruction_following: 0.88,
      long_context: 0.88,
    },
    runtime: { tokens_per_second: 34, peak_vram_gb: 48, usable_context: 131_072 },
    features: { tool_calling: true, multimodal: true },
  },
  {
    model_slug: MODEL_SLUGS.gemmaDocument,
    capabilities: {
      reasoning: 0.85,
      coding: 0.78,
      tool_use: 0.65,
      document_qa: 0.94,
      structured_output: 0.83,
      instruction_following: 0.86,
      long_context: 0.89,
    },
    runtime: { tokens_per_second: 22, peak_vram_gb: 52, usable_context: 131_072 },
    features: { tool_calling: false, multimodal: true },
  },
  {
    model_slug: MODEL_SLUGS.nemotronEfficient,
    capabilities: {
      reasoning: 0.82,
      coding: 0.8,
      tool_use: 0.84,
      document_qa: 0.76,
      structured_output: 0.84,
      instruction_following: 0.83,
      long_context: 0.84,
    },
    runtime: { tokens_per_second: 76, peak_vram_gb: 32, usable_context: 131_072 },
    features: { tool_calling: true, multimodal: false },
  },
] as const satisfies readonly ModelProfile[];

export const DEFAULT_MODEL_CANDIDATES: readonly ModelSlug[] = MVP_MODEL_PROFILES.map(
  (profile) => profile.model_slug,
);

export function isModelSlug(value: string): value is ModelSlug {
  return MVP_MODEL_PROFILES.some((profile) => profile.model_slug === value);
}

export function getModelProfile(modelSlug: ModelSlug): ModelProfile {
  const profile = MVP_MODEL_PROFILES.find((candidate) => candidate.model_slug === modelSlug);
  if (profile === undefined) {
    throw new Error(`Missing profile for model: ${modelSlug}`);
  }
  return profile;
}
