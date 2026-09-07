export const ANCHOR_MODEL_IDS = {
  muse: "muse-spark-1.3-contributor-free",
  mimo: "mimo-v2.5-free",
  ling: "ling-3.0-flash-fin-free",
  nemotronUltra: "nemotron-3-ultra-free",
  nemotronLightning: "nemotron-3.5-lightning-free",
  qwen: "qwen3.8-27b",
} as const;

export type AnchorModelId = (typeof ANCHOR_MODEL_IDS)[keyof typeof ANCHOR_MODEL_IDS];

export const DEFAULT_ANCHOR_MODEL_ID: AnchorModelId = ANCHOR_MODEL_IDS.muse;
export const ANCHOR_MODEL_HEADER = "x-anchor-os-model";
export const ANCHOR_MODEL_AUTH_ATTRIBUTE = "anchorOsModel";

export const ANCHOR_MODELS = [
  {
    id: ANCHOR_MODEL_IDS.muse,
    label: "Muse Spark 1.3 Contributor",
  },
  {
    id: ANCHOR_MODEL_IDS.mimo,
    label: "MiMo V2.5",
  },
  {
    id: ANCHOR_MODEL_IDS.ling,
    label: "Ling 3.0 Flash Fin",
  },
  {
    id: ANCHOR_MODEL_IDS.nemotronUltra,
    label: "Nemotron 3 Ultra",
  },
  {
    id: ANCHOR_MODEL_IDS.nemotronLightning,
    label: "Nemotron 3.5 Lightning",
  },
  {
    id: ANCHOR_MODEL_IDS.qwen,
    label: "Qwen 3.8 27B Max",
  },
] as const satisfies ReadonlyArray<{
  readonly id: AnchorModelId;
  readonly label: string;
}>;

const LEGACY_ANCHOR_MODEL_IDS: Readonly<Record<string, AnchorModelId>> = {
  "muse-spark-1.3-contributor": ANCHOR_MODEL_IDS.muse,
};

export function isAnchorModelId(value: string): value is AnchorModelId {
  return ANCHOR_MODELS.some((model) => model.id === value);
}

export function normalizeAnchorModelId(value: string): AnchorModelId | undefined {
  return isAnchorModelId(value) ? value : LEGACY_ANCHOR_MODEL_IDS[value];
}
