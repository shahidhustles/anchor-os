import { expect, test } from "bun:test";
import {
  BROWSER_CONTROL_OWNER_HEADER,
  PINCHTAB_ALLOWED_TOOLS,
  isPinchtabToolAllowed,
} from "@anchor-os/browser-control/types";
import {
  BROWSER_CONTROL_AUTH_ATTRIBUTE,
  BROWSER_CONTROL_HEADER,
  browserControlMcpUrl,
  fetchBrowserControlStatus,
  parseBrowserControlHeader,
  resolveBrowserControlSetting,
  resolveBrowserConnection,
} from "./browser-control";

const ON = { status: "on" as const, profile: { id: "p1", name: "Anchor OS" } };
const ENABLED = { requested: "on", sessionId: "ses_a" } as const;

test("parses the browser control header strictly on", () => {
  expect(parseBrowserControlHeader("on")).toBe("on");
  expect(parseBrowserControlHeader(" ON ")).toBe("on");
  expect(parseBrowserControlHeader("off")).toBe("off");
  expect(parseBrowserControlHeader("enabled")).toBe("off");
  expect(parseBrowserControlHeader("")).toBe("off");
  expect(parseBrowserControlHeader(null)).toBe("off");
  expect(parseBrowserControlHeader(undefined)).toBe("off");
});

test("keeps the session browser setting when a resumed input response has no attribute", () => {
  expect(resolveBrowserControlSetting(undefined, "on")).toBe("on");
  expect(resolveBrowserControlSetting(undefined, "off")).toBe("off");
  expect(resolveBrowserControlSetting("off", "on")).toBe("off");
});

test("an enabled healthy turn resolves the browser connection", () => {
  const config = resolveBrowserConnection({ ...ENABLED, status: ON });
  expect(config).not.toBeNull();
  expect(config?.url).toBe("http://127.0.0.1:3000/api/browser-control/mcp");
  expect(config?.headers[BROWSER_CONTROL_OWNER_HEADER]).toBe("ses_a");
  expect(config?.tools.allow).toEqual([...PINCHTAB_ALLOWED_TOOLS]);
  expect(config?.description).toContain("Chrome");
});

test("a disabled turn has no browser connection", () => {
  expect(resolveBrowserConnection({ requested: "off", status: ON, sessionId: "ses_a" })).toBeNull();
  expect(
    resolveBrowserConnection({ requested: undefined, status: ON, sessionId: "ses_a" }),
  ).toBeNull();
  expect(resolveBrowserConnection({ requested: true, status: ON, sessionId: "ses_a" })).toBeNull();
});

test("an unhealthy turn has no browser connection even when enabled", () => {
  for (const status of ["off", "starting", "stopping", "error"] as const) {
    expect(resolveBrowserConnection({ ...ENABLED, status: { status } })).toBeNull();
  }
});

test("a blocked PinchTab tool stays outside the eve allowlist", () => {
  const config = resolveBrowserConnection({ ...ENABLED, status: ON });
  expect(config?.tools.allow.includes("pinchtab_evaluate")).toBe(false);
  expect(isPinchtabToolAllowed("pinchtab_evaluate")).toBe(false);
  for (const name of config?.tools.allow ?? []) {
    expect(isPinchtabToolAllowed(name)).toBe(true);
  }
});

test("each session stamps its own id so a second chat is refused as busy", () => {
  const first = resolveBrowserConnection({ ...ENABLED, status: ON });
  const second = resolveBrowserConnection({
    requested: "on",
    status: ON,
    sessionId: "ses_b",
  });
  expect(first?.headers[BROWSER_CONTROL_OWNER_HEADER]).toBe("ses_a");
  expect(second?.headers[BROWSER_CONTROL_OWNER_HEADER]).toBe("ses_b");
  expect(first?.headers[BROWSER_CONTROL_OWNER_HEADER]).not.toBe(
    second?.headers[BROWSER_CONTROL_OWNER_HEADER],
  );
});

test("the mcp url defaults to the local web app and honors the override", () => {
  expect(browserControlMcpUrl({})).toBe("http://127.0.0.1:3000/api/browser-control/mcp");
  expect(browserControlMcpUrl({ PORT: "65430" })).toBe(
    "http://127.0.0.1:3000/api/browser-control/mcp",
  );
  expect(browserControlMcpUrl({ ANCHOR_BROWSER_CONTROL_URL: "http://127.0.0.1:9/x" })).toBe(
    "http://127.0.0.1:9/x",
  );
});

test("header and attribute names are stable constants", () => {
  expect(BROWSER_CONTROL_HEADER).toBe("x-anchor-os-browser-control");
  expect(BROWSER_CONTROL_AUTH_ATTRIBUTE).toBe("anchorOsBrowserControl");
});

test("fetches the status endpoint and reads the live state", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      if (new URL(request.url).pathname === "/api/browser-control") {
        return Response.json({ status: "on" });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  try {
    const env = { ANCHOR_BROWSER_CONTROL_URL: `http://127.0.0.1:${server.port}/mcp` };
    expect(await fetchBrowserControlStatus(env)).toEqual({ status: "on" });
  } finally {
    server.stop(true);
  }
});

test("fails closed when the status endpoint is down or broken", async () => {
  const env = { ANCHOR_BROWSER_CONTROL_URL: "http://127.0.0.1:1/mcp" };
  const unreachable = await fetchBrowserControlStatus(env);
  expect(unreachable.status).toBe("error");

  const server = Bun.serve({
    port: 0,
    fetch: () => Response.json({ error: "boom" }, { status: 500 }),
  });
  try {
    const env2 = { ANCHOR_BROWSER_CONTROL_URL: `http://127.0.0.1:${server.port}/mcp` };
    const broken = await fetchBrowserControlStatus(env2);
    expect(broken.status).toBe("error");
    expect(broken.error).toContain("500");
  } finally {
    server.stop(true);
  }
});
