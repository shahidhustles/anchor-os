import { DEFAULT_MODEL_CANDIDATES, type ModelSlug } from "@anchor-os/model-router/profiles";

export const ANCHOR_MODEL_IDS = {
  muse: "muse-spark-1.3-contributor",
  qwen: "qwen3.8-27b",
} as const;

export type AnchorModelId =
  | (typeof ANCHOR_MODEL_IDS)[keyof typeof ANCHOR_MODEL_IDS]
  | "auto"
  | `local:${ModelSlug}`;

export const DEFAULT_ANCHOR_MODEL_ID: AnchorModelId = ANCHOR_MODEL_IDS.muse;
export const ANCHOR_MODEL_HEADER = "x-anchor-os-model";
export const ANCHOR_MODEL_AUTH_ATTRIBUTE = "anchorOsModel";

export const ANCHOR_MODELS = [
  { id: "auto", label: "Auto · Local router" },
  ...DEFAULT_MODEL_CANDIDATES.map((slug) => ({
    id: `local:${slug}` as const,
    label: `Local · ${slug}`,
  })),
  {
    id: ANCHOR_MODEL_IDS.muse,
    label: "Muse Spark 1.3 Contributor",
  },
  {
    id: ANCHOR_MODEL_IDS.qwen,
    label: "Qwen 3.8 27B Max",
  },
] as const satisfies ReadonlyArray<{
  readonly id: AnchorModelId;
  readonly label: string;
}>;

export function isAnchorModelId(value: string): value is AnchorModelId {
  return ANCHOR_MODELS.some((model) => model.id === value);
}
