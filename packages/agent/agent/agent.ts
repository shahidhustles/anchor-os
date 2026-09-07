import { defineAgent, defineDynamic } from "eve";

import { createOpenCodeModelSelection, isOpenCodeModelId } from "./lib/opencode-model";
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
          context.session.auth.initiator?.attributes[ANCHOR_MODEL_AUTH_ATTRIBUTE],
        );

        if (modelId === ANCHOR_MODEL_IDS.qwen) {
          return {
            model: createQwenModel(),
            modelContextWindowTokens: qwenContextWindowTokens(),
          };
        }

        if (isOpenCodeModelId(modelId)) {
          return createOpenCodeModelSelection(context.session.id, modelId);
        }

        const _exhaustive: never = modelId;
        return _exhaustive;
      },
    },
  }),
});
