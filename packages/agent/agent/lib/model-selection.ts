import { DEFAULT_ANCHOR_MODEL_ID, isAnchorModelId, type AnchorModelId } from "../../model-catalog";

export function resolveModelId(value: unknown): AnchorModelId {
  return typeof value === "string" && isAnchorModelId(value) ? value : DEFAULT_ANCHOR_MODEL_ID;
}
