import { readFileSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { defineState } from "eve/context";
import { autoCandidates, registrySchema, type CandidateEndpoint } from "./registry";
import { createLocalRouter, selectSessionModel, type SessionSelection } from "./runtime";

const selection = defineState<SessionSelection | null>("anchor-os.model-router.v1", () => null);

export function clearRoutedSelection() {
  selection.update(() => null);
}

function headersFor(entry: CandidateEndpoint): Record<string, string> {
  if (!entry.api_key_env) return {};
  const key = process.env[entry.api_key_env];
  if (!key) throw new Error(`Missing model credential environment variable: ${entry.api_key_env}`);
  return { Authorization: `Bearer ${key}` };
}

export async function resolveRoutedModel(input: { requested: string; task: string }) {
  const path = process.env.ANCHOR_MODEL_REGISTRY;
  if (!path) throw new Error("Set ANCHOR_MODEL_REGISTRY to a local candidate registry JSON file");
  const entries = registrySchema.parse(JSON.parse(readFileSync(path, "utf8")));
  const localEntries = entries.filter((entry) => entry.location === "local");
  const pool = input.requested === "auto" ? autoCandidates(entries) : localEntries;
  const onEvent = (event: unknown) => process.stderr.write(`${JSON.stringify(event)}\n`);
  const current = selection.get();
  const selected = await selectSessionModel({
    selection:
      input.requested === "auto"
        ? { mode: "auto" }
        : { mode: "manual", model_slug: input.requested },
    current,
    autoEnabled: process.env.ANCHOR_ROUTER_AUTO_ENABLED === "true",
    request: {
      user_task: input.task,
      candidate_models: pool.map((e) => e.profile.model_slug),
      profiles: pool.map((e) => e.profile),
      // EVE is an agent with tools; every Auto primary must support them.
      requires_tools: true,
      input_tokens: Math.ceil(Buffer.byteLength(input.task, "utf8") / 4) + 4096,
    },
    route: (request) =>
      createLocalRouter({
        url: process.env.ANCHOR_ROUTER_URL,
        fallbackModel: process.env.ANCHOR_ROUTER_FALLBACK_MODEL,
        onEvent,
      })(request),
    async loadModel(slug) {
      const entry = pool.find((e) => e.profile.model_slug === slug);
      if (!entry) throw new Error("Selected endpoint missing from registry");
      // A real one-token generation verifies the model can load. Listing /models does not.
      const response = await fetch(`${entry.base_url.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersFor(entry) },
        body: JSON.stringify({
          model: entry.served_model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 1,
          stream: false,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error("Candidate model failed its load check");
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        !("choices" in body) ||
        !Array.isArray(body.choices) ||
        !body.choices.length
      ) {
        throw new Error("Candidate did not return a completion");
      }
    },
    onEvent,
  });
  selection.update(() => selected);
  const entry = entries.find((e) => e.profile.model_slug === selected.result.model_slug);
  if (!entry) throw new Error("Locked model is no longer configured. Select a model manually.");
  const provider = createOpenAICompatible({
    name: "anchor-local",
    baseURL: entry.base_url,
    headers: headersFor(entry),
    includeUsage: true,
  });
  return {
    model: provider.chatModel(entry.served_model),
    modelContextWindowTokens: entry.profile.runtime.usable_context,
  };
}
