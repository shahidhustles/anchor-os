import {
  getModelProfile,
  PROFILE_VERSION,
  type CapabilityScores,
  type ModelProfile,
  type ModelSlug,
} from "./profiles";

export type RouteResult = Readonly<{
  model_slug: ModelSlug;
  confidence: number;
}>;

export type RouteEvent =
  | Readonly<{
      kind: "route_selected";
      model_slug: ModelSlug;
      confidence: number;
      candidates: readonly ModelSlug[];
      profile_version: string;
      routing_time_ms: number;
    }>
  | Readonly<{
      kind: "model_load_failed";
      model_slug: ModelSlug;
      remaining_candidates: readonly ModelSlug[];
    }>;

type TaskRequirements = CapabilityScores &
  Readonly<{
    requires_tool_calling: boolean;
  }>;

type RankedModel = Readonly<{
  modelSlug: ModelSlug;
  score: number;
  sufficient: boolean;
}>;

const CAPABILITY_KEYS = [
  "reasoning",
  "coding",
  "tool_use",
  "document_qa",
  "structured_output",
  "instruction_following",
  "long_context",
] as const satisfies readonly (keyof CapabilityScores)[];

const TASK_SIGNALS = {
  coding: [
    "code",
    "coding",
    "debug",
    "bug",
    "typescript",
    "javascript",
    "python",
    "api",
    "function",
    "test",
    "repository",
  ],
  reasoning: [
    "calculate",
    "calculation",
    "derive",
    "equation",
    "math",
    "proof",
    "reason",
    "solve",
    "step by step",
  ],
  document: [
    "approval note",
    "docx",
    "document",
    "drawing",
    "inspection report",
    "manual",
    "pdf",
    "presentation",
    "report",
    "spreadsheet",
    "word",
    "xlsx",
  ],
  structured: ["csv", "extract", "json", "schema", "table", "template", "validate"],
  tool: ["execute", "file", "run", "sandbox", "search", "tool", "verify"],
  artifactAction: ["create", "generate", "write"],
  longContext: [
    "entire codebase",
    "large document",
    "long context",
    "multiple files",
    "whole repository",
  ],
} as const;

function containsSignal(task: string, signals: readonly string[]): boolean {
  return signals.some((signal) => {
    const escapedSignal = signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escapedSignal}($|[^a-z0-9])`, "u").test(task);
  });
}

function inferTaskRequirements(task: string): TaskRequirements {
  const normalizedTask = task.trim().toLowerCase();
  const isCoding = containsSignal(normalizedTask, TASK_SIGNALS.coding);
  const isReasoning = containsSignal(normalizedTask, TASK_SIGNALS.reasoning);
  const isDocument = containsSignal(normalizedTask, TASK_SIGNALS.document);
  const isStructured = containsSignal(normalizedTask, TASK_SIGNALS.structured);
  const hasArtifactAction = containsSignal(normalizedTask, TASK_SIGNALS.artifactAction);
  const usesTools =
    containsSignal(normalizedTask, TASK_SIGNALS.tool) ||
    (hasArtifactAction && (isCoding || isDocument));
  const usesLongContext = containsSignal(normalizedTask, TASK_SIGNALS.longContext);

  return {
    reasoning: isReasoning ? 0.94 : isCoding ? 0.62 : 0.38,
    coding: isCoding ? 0.94 : 0.2,
    tool_use: usesTools ? 0.88 : 0.28,
    document_qa: isDocument ? 0.9 : 0.22,
    structured_output: isDocument || isStructured ? 0.88 : isCoding ? 0.62 : 0.35,
    instruction_following: isDocument ? 0.9 : 0.62,
    long_context: usesLongContext ? 0.92 : isDocument ? 0.66 : 0.3,
    requires_tool_calling: usesTools,
  };
}

function normalizedRuntimeScore(profile: ModelProfile, profiles: readonly ModelProfile[]): number {
  const fastest = Math.max(...profiles.map((candidate) => candidate.runtime.tokens_per_second));
  const lowestVram = Math.min(...profiles.map((candidate) => candidate.runtime.peak_vram_gb));
  const speedScore = profile.runtime.tokens_per_second / fastest;
  const vramScore = lowestVram / profile.runtime.peak_vram_gb;
  return speedScore * 0.65 + vramScore * 0.35;
}

function capabilityFit(profile: ModelProfile, requirements: TaskRequirements): number {
  let weightedFit = 0;
  let totalWeight = 0;

  for (const capability of CAPABILITY_KEYS) {
    const weight = Math.max(requirements[capability], 0.05);
    weightedFit += Math.min(profile.capabilities[capability] / weight, 1.15) * weight;
    totalWeight += weight;
  }

  return weightedFit / totalWeight;
}

function isSufficient(profile: ModelProfile, requirements: TaskRequirements): boolean {
  if (requirements.requires_tool_calling && !profile.features.tool_calling) return false;

  return CAPABILITY_KEYS.every((capability) => {
    const demand = requirements[capability];
    return demand < 0.8 || profile.capabilities[capability] >= demand - 0.01;
  });
}

function rankModels(task: string, candidates: readonly ModelSlug[]): readonly RankedModel[] {
  if (!task.trim()) throw new Error("Model router requires a nonempty task");
  const requirements = inferTaskRequirements(task);
  const profiles = candidates
    .map(getModelProfile)
    .filter((profile) => !requirements.requires_tool_calling || profile.features.tool_calling);
  if (!profiles.length) throw new Error("No compatible candidate models");

  return profiles
    .map((profile) => {
      const sufficient = isSufficient(profile, requirements);
      const quality = capabilityFit(profile, requirements);
      const efficiency = normalizedRuntimeScore(profile, profiles);
      return {
        modelSlug: profile.model_slug,
        score: quality * 0.72 + efficiency * 0.28,
        sufficient,
      };
    })
    .sort((left, right) => {
      if (left.sufficient !== right.sufficient) return left.sufficient ? -1 : 1;
      if (right.score !== left.score) return right.score - left.score;
      return left.modelSlug.localeCompare(right.modelSlug);
    });
}

function routeConfidence(rankedModels: readonly RankedModel[]): number {
  if (rankedModels.length === 1) return 0.95;
  const first = rankedModels[0];
  const second = rankedModels[1];
  if (first === undefined || second === undefined) return 0.5;
  if (first.sufficient && !second.sufficient) return 0.9;

  const margin = Math.max(0, first.score - second.score);
  const confidence = 0.55 + Math.min(margin * 1.8, 0.4);
  return Number(confidence.toFixed(2));
}

function validateCandidates(candidates: readonly ModelSlug[]): void {
  if (candidates.length === 0) throw new Error("Model router requires at least one candidate");
  if (new Set(candidates).size !== candidates.length) {
    throw new Error("Model router candidates must be unique");
  }
}

export function routeModel(
  input: Readonly<{
    task: string;
    candidates: readonly ModelSlug[];
  }>,
): RouteResult {
  validateCandidates(input.candidates);
  const rankedModels = rankModels(input.task, input.candidates);
  const selected = rankedModels[0];
  if (selected === undefined) throw new Error("Model router could not select a candidate");

  return {
    model_slug: selected.modelSlug,
    confidence: routeConfidence(rankedModels),
  };
}

export async function routeWithLoadFallback(
  input: Readonly<{
    task: string;
    candidates: readonly ModelSlug[];
    loadModel: (modelSlug: ModelSlug) => Promise<void>;
    onEvent?: (event: RouteEvent) => void;
  }>,
): Promise<RouteResult> {
  validateCandidates(input.candidates);
  let remainingCandidates = [...input.candidates];
  const loadErrors: unknown[] = [];

  while (remainingCandidates.length > 0) {
    const startedAt = performance.now();
    const result = routeModel({ task: input.task, candidates: remainingCandidates });
    input.onEvent?.({
      kind: "route_selected",
      ...result,
      candidates: remainingCandidates,
      profile_version: PROFILE_VERSION,
      routing_time_ms: Number((performance.now() - startedAt).toFixed(2)),
    });

    try {
      await input.loadModel(result.model_slug);
      return result;
    } catch (error: unknown) {
      loadErrors.push(error);
      remainingCandidates = remainingCandidates.filter(
        (candidate) => candidate !== result.model_slug,
      );
      input.onEvent?.({
        kind: "model_load_failed",
        model_slug: result.model_slug,
        remaining_candidates: remainingCandidates,
      });
    }
  }

  throw new AggregateError(loadErrors, "No candidate model could be loaded");
}
