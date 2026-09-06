import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";
import { defaultEveAuth, eveChannel } from "eve/channels/eve";

import { ANCHOR_MODEL_AUTH_ATTRIBUTE, ANCHOR_MODEL_HEADER } from "../../model-catalog";
import {
  BROWSER_CONTROL_AUTH_ATTRIBUTE,
  BROWSER_CONTROL_HEADER,
  parseBrowserControlHeader,
} from "../lib/browser-control";
import { resolveModelId } from "../lib/model-selection";

export default eveChannel({
  auth: [vercelOidc(), localDev(), placeholderAuth()],
  onMessage(context) {
    const auth = defaultEveAuth(context);
    if (auth === null) return { auth };

    const modelHeader = context.eve.request.headers.get(ANCHOR_MODEL_HEADER);
    const browserControlHeader = context.eve.request.headers.get(BROWSER_CONTROL_HEADER);
    return {
      auth: {
        ...auth,
        attributes: {
          ...auth.attributes,
          ...(modelHeader === null
            ? {}
            : { [ANCHOR_MODEL_AUTH_ATTRIBUTE]: resolveModelId(modelHeader) }),
          ...(browserControlHeader === null
            ? {}
            : {
                [BROWSER_CONTROL_AUTH_ATTRIBUTE]: parseBrowserControlHeader(browserControlHeader),
              }),
        },
      },
    };
  },
});
