import { z } from "zod";
import { profileSchema } from "./runtime";

export const registrySchema = z
  .array(
    z.object({
      profile: profileSchema,
      provider: z.literal("openai-compatible"),
      location: z.enum(["local", "hosted"]),
      auto_eligible: z.boolean(),
      base_url: z.string().url(),
      served_model: z.string().min(1),
      api_key_env: z.string().min(1).optional(),
    }),
  )
  .superRefine((entries, ctx) => {
    if (new Set(entries.map((e) => e.profile.model_slug)).size !== entries.length) {
      ctx.addIssue({ code: "custom", message: "Registry slugs must be unique" });
    }
    for (const entry of entries) {
      const url = new URL(entry.base_url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Use an HTTP endpoint without credentials, query, or fragment",
        });
      }
    }
  });
export type CandidateEndpoint = z.infer<typeof registrySchema>[number];

export function autoCandidates(entries: readonly CandidateEndpoint[]) {
  // Local is an operator declaration. Network egress must also be enforced by the deployment.
  return entries.filter((e) => e.location === "local" && e.auto_eligible);
}
