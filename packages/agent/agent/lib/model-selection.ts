import { DEFAULT_ANCHOR_MODEL_ID, isAnchorModelId, type AnchorModelId } from "../../model-catalog";

export function resolveModelId(value: unknown, sessionFallback?: unknown): AnchorModelId {
  if (typeof value === "string" && isAnchorModelId(value)) return value;
  if (value === undefined && typeof sessionFallback === "string" && isAnchorModelId(sessionFallback)) {
    return sessionFallback;
  }
  return DEFAULT_ANCHOR_MODEL_ID;
}
