import { defineDynamic, defineMcpClientConnection } from "eve/connections";

import {
  BROWSER_CONTROL_AUTH_ATTRIBUTE,
  fetchBrowserControlStatus,
  resolveBrowserConnection,
} from "../lib/browser-control";

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      if (ctx.session.auth.current?.attributes[BROWSER_CONTROL_AUTH_ATTRIBUTE] !== "on") {
        return null;
      }

      const status = await fetchBrowserControlStatus();
      const config = resolveBrowserConnection({
        requested: "on",
        status,
        sessionId: ctx.session.id,
      });
      if (config === null) return null;

      return defineMcpClientConnection({
        url: config.url,
        description: config.description,
        headers: config.headers,
        tools: config.tools,
      });
    },
  },
});
