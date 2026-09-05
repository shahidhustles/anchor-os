import { defineAgent, defineDynamic } from "eve";

import {
  createOpenCodeModel,
  OPENCODE_CONTEXT_WINDOW_TOKENS,
  OPENCODE_MODEL_OPTIONS,
} from "./lib/opencode-model";
import { resolveModelId } from "./lib/model-selection";
import { createQwenModel, qwenContextWindowTokens } from "./lib/qwen-model";
import { ANCHOR_MODEL_AUTH_ATTRIBUTE, ANCHOR_MODEL_IDS } from "../model-catalog";

export default defineAgent({
  limits: {
    sessionTimeoutMs: false,
  },
  model: defineDynamic({
    events: {
      "step.started": (_event, context) => {
        const modelId = resolveModelId(
          context.session.auth.current?.attributes[ANCHOR_MODEL_AUTH_ATTRIBUTE],
        );

        if (modelId === ANCHOR_MODEL_IDS.qwen) {
          return {
            model: createQwenModel(),
            modelContextWindowTokens: qwenContextWindowTokens(),
          };
        }

        return {
          model: createOpenCodeModel(context.session.id),
          modelContextWindowTokens: OPENCODE_CONTEXT_WINDOW_TOKENS,
          modelOptions: OPENCODE_MODEL_OPTIONS,
        };
      },
    },
  }),
  reasoning: "xhigh",
});
