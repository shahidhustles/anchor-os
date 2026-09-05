import { defineAgent, defineDynamic } from "eve";

import {
  createOpenCodeModel,
  OPENCODE_CONTEXT_WINDOW_TOKENS,
  OPENCODE_MODEL_OPTIONS,
} from "./lib/opencode-model";

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": (_event, context) => ({
        model: createOpenCodeModel(context.session.id),
        modelContextWindowTokens: OPENCODE_CONTEXT_WINDOW_TOKENS,
        modelOptions: OPENCODE_MODEL_OPTIONS,
      }),
    },
  }),
  reasoning: "xhigh",
});
