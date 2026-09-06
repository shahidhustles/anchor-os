import { z } from "zod";

const score = z.number().finite().min(0).max(1);
export const profileSchema = z.object({
  model_slug: z.string().min(1),
  capabilities: z.object({
    reasoning: score,
    coding: score,
    tool_use: score,
    document_qa: score,
    structured_output: score,
    instruction_following: score,
    long_context: score,
  }),
  runtime: z.object({
    tokens_per_second: z.number().positive().finite(),
    peak_vram_gb: z.number().positive().finite(),
    usable_context: z.number().int().positive(),
  }),
  features: z.object({ tool_calling: z.boolean(), multimodal: z.boolean() }),
});
export const requestSchema = z
  .object({
    user_task: z.string().trim().min(1),
    candidate_models: z.array(z.string().min(1)).min(1),
    profiles: z.array(profileSchema).min(1),
    requires_tools: z.boolean().default(false),
    input_tokens: z.number().int().nonnegative().default(0),
  })
  .superRefine((value, ctx) => {
    const slugs = new Set(value.candidate_models);
    if (
      slugs.size !== value.candidate_models.length ||
      value.profiles.length !== slugs.size ||
      new Set(value.profiles.map((p) => p.model_slug)).size !== slugs.size ||
      value.profiles.some((p) => !slugs.has(p.model_slug))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one profile per unique candidate is required",
      });
    }
  });
export const resultSchema = z.object({ model_slug: z.string().min(1), confidence: score }).strict();
export type RoutingRequest = z.input<typeof requestSchema>;
export type RoutingResult = z.infer<typeof resultSchema>;
export type RuntimeProfile = z.infer<typeof profileSchema>;
export type RuntimeEvent =
  | { kind: "router_fallback"; reason: "unavailable_or_invalid" }
  | { kind: "model_load_failed"; model_slug: string }
  | { kind: "session_model_selected"; model_slug: string; confidence: number };

export function eligibleRequest(input: RoutingRequest): z.output<typeof requestSchema> {
  const request = requestSchema.parse(input);
  const profiles = request.profiles.filter(
    (p) =>
      (!request.requires_tools || p.features.tool_calling) &&
      p.runtime.usable_context >= request.input_tokens,
  );
  if (!profiles.length) throw new Error("No compatible candidate models");
  return { ...request, profiles, candidate_models: profiles.map((p) => p.model_slug) };
}

function fallback(request: z.output<typeof requestSchema>, configured?: string): RoutingResult {
  const chosen = request.profiles.find((p) => p.model_slug === configured);
  if (chosen) return { model_slug: chosen.model_slug, confidence: 0 };
  // Conservative fallback: quality first, throughput breaks equal scores.
  const ranked = [...request.profiles].sort((a, b) => {
    const quality = (p: RuntimeProfile) => Object.values(p.capabilities).reduce((x, y) => x + y, 0);
    return (
      quality(b) - quality(a) ||
      b.runtime.tokens_per_second - a.runtime.tokens_per_second ||
      a.model_slug.localeCompare(b.model_slug)
    );
  });
  const first = ranked[0];
  if (!first) throw new Error("No compatible candidate models");
  return { model_slug: first.model_slug, confidence: 0 };
}

export function createLocalRouter(
  options: {
    url?: string;
    timeoutMs?: number;
    fallbackModel?: string;
    onEvent?: (event: RuntimeEvent) => void;
  } = {},
) {
  const url = new URL(options.url ?? "http://127.0.0.1:8787/route");
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Router URL must use loopback HTTP");
  return async (input: RoutingRequest): Promise<RoutingResult> => {
    const request = eligibleRequest(input);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
      if (!response.ok) throw new Error("Local router unavailable");
      const result = resultSchema.parse(await response.json());
      if (!request.candidate_models.includes(result.model_slug))
        throw new Error("Invalid candidate");
      return result;
    } catch {
      options.onEvent?.({ kind: "router_fallback", reason: "unavailable_or_invalid" });
      return fallback(request, options.fallbackModel);
    }
  };
}

export type SessionSelection = { mode: "auto" | "manual"; result: RoutingResult };

/** Caller persists the returned selection in its own session storage. */
export async function selectSessionModel(options: {
  selection: { mode: "auto" } | { mode: "manual"; model_slug: string };
  current: SessionSelection | null;
  request: RoutingRequest;
  autoEnabled: boolean;
  route: (input: RoutingRequest) => Promise<RoutingResult>;
  loadModel: (slug: string) => Promise<void>;
  onEvent?: (event: RuntimeEvent) => void;
}): Promise<SessionSelection> {
  const { selection, current } = options;
  if (selection.mode === "auto" && current?.mode === "auto") return current;
  if (selection.mode === "manual") {
    if (current?.result.model_slug === selection.model_slug && current.mode === "manual")
      return current;
    // Manual choices bypass inference and Auto compatibility filters.
    if (!options.request.candidate_models.includes(selection.model_slug))
      throw new Error("Unknown manual model");
    await options.loadModel(selection.model_slug);
    return { mode: "manual", result: { model_slug: selection.model_slug, confidence: 1 } };
  }
  if (!options.autoEnabled) throw new Error("Auto mode is disabled. Select a model manually.");
  let request = eligibleRequest(options.request);
  while (request.profiles.length) {
    const result = resultSchema.parse(await options.route(request));
    if (!request.candidate_models.includes(result.model_slug)) throw new Error("Invalid candidate");
    try {
      await options.loadModel(result.model_slug);
    } catch {
      options.onEvent?.({ kind: "model_load_failed", model_slug: result.model_slug });
      request = {
        ...request,
        candidate_models: request.candidate_models.filter((s) => s !== result.model_slug),
        profiles: request.profiles.filter((p) => p.model_slug !== result.model_slug),
      };
      continue;
    }
    options.onEvent?.({ kind: "session_model_selected", ...result });
    return { mode: "auto", result };
  }
  throw new Error("No candidate model could be loaded");
}
