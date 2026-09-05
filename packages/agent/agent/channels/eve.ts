import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import { ANCHOR_MODEL_AUTH_ATTRIBUTE, ANCHOR_MODEL_HEADER } from "../../model-catalog";
import { resolveModelId } from "../lib/model-selection";

export default eveChannel({
  auth: [vercelOidc(), localDev(), placeholderAuth()],
  onMessage(context) {
    const auth = defaultEveAuth(context);
    if (auth === null) return { auth };

    const modelId = resolveModelId(context.eve.request.headers.get(ANCHOR_MODEL_HEADER));
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          [ANCHOR_MODEL_AUTH_ATTRIBUTE]: modelId,
        },
      },
    };
  },
});
