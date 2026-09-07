import assert from "node:assert/strict";
import { test } from "node:test";

import {
  disableBrowserControl,
  enableBrowserControl,
  getBrowserControlState,
  handleBrowserControlMcpRequest,
  resetBrowserControlForTests,
} from "./browser-control-server";
import type { BrowserControlDeps } from "./browser-control-server";
import type { PinchtabClient, StartedPinchtabServer } from "./pinchtab-process";
import type { BrowserBridge, PinchtabTab } from "./types";

type Calls = {
  startServer: number;
  startInstance: number;
  stopServer: number;
  stopInstance: number;
  bridgeClose: number;
  bridgeCreated: number;
  listTabs: number;
  navigateTab: number;
};

function makeDeps(
  overrides: {
    healthy?: boolean;
    becomesHealthy?: boolean;
    startServerResult?: StartedPinchtabServer | null;
    instanceReady?: boolean;
    failCreateBridge?: boolean;
    strategy?: string;
    listTabsResult?: PinchtabTab[];
  } = {},
): { deps: BrowserControlDeps; calls: Calls } {
  const calls: Calls = {
    startServer: 0,
    startInstance: 0,
    stopServer: 0,
    stopInstance: 0,
    bridgeClose: 0,
    bridgeCreated: 0,
    listTabs: 0,
    navigateTab: 0,
  };

  const pinchtab: PinchtabClient = {
    readConfig: async () => ({
      serverUrl: "http://127.0.0.1:9867",
      token: "token",
      strategy: overrides.strategy ?? "explicit",
    }),
    checkHealth: async () => overrides.healthy ?? true,
    waitForHealthy: async () => overrides.becomesHealthy ?? true,
    startServer: async () => {
      calls.startServer += 1;
      return overrides.startServerResult ?? null;
    },
    stopServer: async () => {
      calls.stopServer += 1;
    },
    findOrCreateAnchorProfile: async () => ({ id: "prof_anchor", name: "Anchor OS" }),
    findRunningInstanceForProfile: async () => null,
    startHeadedInstance: async () => {
      calls.startInstance += 1;
      return { id: `inst_anchor_${calls.startInstance}`, status: "running" };
    },
    waitForInstanceRunning: async () => overrides.instanceReady ?? true,
    stopInstance: async () => {
      calls.stopInstance += 1;
    },
    listTabs: async () => {
      calls.listTabs += 1;
      return overrides.listTabsResult ?? [{ id: "tab_blank", url: "about:blank" }];
    },
    navigateTab: async (_serverUrl, tabId, url) => {
      calls.navigateTab += 1;
      return { id: tabId, url };
    },
  };

  const bridge: BrowserBridge = {
    handleRequest: async (request) =>
      Response.json({ ok: true, url: request.url }, { status: 200 }),
    close: async () => {
      calls.bridgeClose += 1;
    },
  };

  const deps: BrowserControlDeps = {
    pinchtab,
    createBridge: async () => {
      calls.bridgeCreated += 1;
      if (overrides.failCreateBridge) throw new Error("bridge exploded");
      return bridge;
    },
  };

  return { deps, calls };
}

function mcpToolRequest(name: string, args: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name, arguments: args },
      id: 1,
    }),
  });
}

test("starts off", () => {
  resetBrowserControlForTests();
  assert.equal(getBrowserControlState().status, "off");
});

test("enable arms browser control without launching Chrome", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ healthy: true });

  const started = await enableBrowserControl(deps);
  assert.equal(started.status, "on");
  assert.deepEqual(started.profile, { id: "prof_anchor", name: "Anchor OS" });
  assert.equal(calls.startServer, 0);
  assert.equal(calls.startInstance, 0);
  assert.equal(calls.bridgeCreated, 1);

  const disabled = await disableBrowserControl();
  assert.equal(disabled.status, "off");
  assert.equal(calls.stopServer, 0, "must not stop a pre-existing server");
  assert.equal(calls.bridgeClose, 1);
  assert.equal(calls.stopInstance, 0, "there is no browser instance before the first tool call");
});

test("enable starts an owned server when unhealthy and stops it on disable", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({
    healthy: false,
    becomesHealthy: true,
    startServerResult: { pid: 1234, url: "http://127.0.0.1:9867", token: "token" },
  });

  const started = await enableBrowserControl(deps);
  assert.equal(started.status, "on");
  assert.equal(calls.startServer, 1);
  assert.equal(calls.stopServer, 0);

  const disabled = await disableBrowserControl();
  assert.equal(disabled.status, "off");
  assert.equal(calls.stopServer, 1, "stops the server Anchor OS started");
});

test("enable is idempotent while on", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  await enableBrowserControl(deps);
  const second = await enableBrowserControl(deps);
  assert.equal(second.status, "on");
  assert.equal(calls.startServer, 0);
  assert.equal(calls.bridgeCreated, 1);
});

test("failed server start leaves an error state with nothing owned", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ healthy: false, startServerResult: null });

  const result = await enableBrowserControl(deps);
  assert.equal(result.status, "error");
  assert.ok(result.error !== undefined);

  const disabled = await disableBrowserControl();
  assert.equal(disabled.status, "off");
  assert.equal(calls.stopServer, 0);
});

test("enable fails closed when PinchTab would manage browser startup itself", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ strategy: "always-on" });

  const result = await enableBrowserControl(deps);

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /explicit strategy/);
  assert.equal(calls.startServer, 0);
  assert.equal(calls.startInstance, 0);
});

test("the first browser tool call launches the headed profile", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  await enableBrowserControl(deps);

  const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "pinchtab_navigate", arguments: { url: "https://example.com" } },
      id: 1,
    }),
  });
  const response = await handleBrowserControlMcpRequest(request);

  assert.equal(response.status, 200);
  assert.equal(calls.startInstance, 1);

  await disableBrowserControl();
  assert.equal(calls.stopInstance, 1, "disable stops the instance Anchor OS launched");
});

test("a first navigate opens the browser directly on the requested page", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  const navigations: Array<{ tabId: string; url: string }> = [];
  deps.pinchtab.navigateTab = async (_serverUrl, tabId, url) => {
    navigations.push({ tabId, url });
    return { id: tabId, url };
  };
  await enableBrowserControl(deps);

  const response = await handleBrowserControlMcpRequest(
    mcpToolRequest("pinchtab_navigate", { url: "https://example.com/start" }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.startInstance, 1);
  assert.equal(calls.listTabs, 1, "the startup tab is already listed, no polling needed");
  assert.deepEqual(navigations, [{ tabId: "tab_blank", url: "https://example.com/start" }]);
});

test("waits for the startup tab before landing the navigation", async () => {
  resetBrowserControlForTests();
  const { deps } = makeDeps();
  let listCalls = 0;
  deps.pinchtab.listTabs = async () => {
    listCalls += 1;
    return listCalls >= 2 ? [{ id: "tab_blank", url: "chrome://newtab/" }] : [];
  };
  const navigations: string[] = [];
  deps.pinchtab.navigateTab = async (_serverUrl, _tabId, url) => {
    navigations.push(url);
    return { id: "tab_blank", url };
  };
  await enableBrowserControl(deps);

  const response = await handleBrowserControlMcpRequest(
    mcpToolRequest("pinchtab_navigate", { url: "https://example.com" }),
  );

  assert.equal(response.status, 200);
  assert.ok(listCalls >= 2, "retries the tab list until the startup tab appears");
  assert.deepEqual(navigations, ["https://example.com"]);
});

test("a first non-navigate call launches the browser without landing a page", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  await enableBrowserControl(deps);

  const response = await handleBrowserControlMcpRequest(mcpToolRequest("pinchtab_snapshot", {}));

  assert.equal(response.status, 200);
  assert.equal(calls.startInstance, 1);
  assert.equal(calls.listTabs, 0);
  assert.equal(calls.navigateTab, 0);
});

test("reusing a running instance does not land a navigation", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  deps.pinchtab.findRunningInstanceForProfile = async () => ({
    id: "inst_existing",
    profileId: "prof_anchor",
    status: "running",
  });
  await enableBrowserControl(deps);

  const response = await handleBrowserControlMcpRequest(
    mcpToolRequest("pinchtab_navigate", { url: "https://example.com" }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.startInstance, 0);
  assert.equal(calls.navigateTab, 0, "the bridge routes the call into the existing window");
});

test("a failed startup landing still forwards the tool call", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  let landingAttempts = 0;
  deps.pinchtab.navigateTab = async () => {
    landingAttempts += 1;
    throw new Error("navigation failed");
  };
  await enableBrowserControl(deps);

  const response = await handleBrowserControlMcpRequest(
    mcpToolRequest("pinchtab_navigate", { url: "https://example.com" }),
  );

  assert.equal(response.status, 200, "the bridge still handles the navigation");
  assert.equal(calls.startInstance, 1);
  assert.equal(landingAttempts, 1);
});

test("disable leaves a pre-existing browser instance running", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  deps.pinchtab.findRunningInstanceForProfile = async () => ({
    id: "inst_preexisting",
    profileId: "prof_anchor",
    status: "running",
  });
  await enableBrowserControl(deps);

  const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "pinchtab_snapshot", arguments: {} },
      id: 1,
    }),
  });
  await handleBrowserControlMcpRequest(request);
  await disableBrowserControl();

  assert.equal(calls.startInstance, 0);
  assert.equal(calls.stopInstance, 0);
});

test("MCP setup and tool discovery do not launch Chrome", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  await enableBrowserControl(deps);

  for (const method of ["initialize", "tools/list", "ping"]) {
    const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, id: 1 }),
    });
    assert.equal((await handleBrowserControlMcpRequest(request)).status, 200);
  }

  assert.equal(calls.startInstance, 0);
});

test("a later browser call relaunches the profile after Chrome closes", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps();
  let runningInstance: { id: string; status: string } | null = null;
  deps.pinchtab.findRunningInstanceForProfile = async () => runningInstance;
  deps.pinchtab.startHeadedInstance = async () => {
    calls.startInstance += 1;
    runningInstance = { id: `inst_anchor_${calls.startInstance}`, status: "running" };
    return runningInstance;
  };
  await enableBrowserControl(deps);

  const toolRequest = () =>
    new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "pinchtab_snapshot", arguments: {} },
        id: 1,
      }),
    });

  await handleBrowserControlMcpRequest(toolRequest());
  assert.equal(calls.startInstance, 1);
  runningInstance = null;
  await handleBrowserControlMcpRequest(toolRequest());
  assert.equal(calls.startInstance, 2);
});

test("failed instance readiness returns an MCP error and cleans up the instance", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ instanceReady: false });
  await enableBrowserControl(deps);

  const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "pinchtab_navigate", arguments: { url: "https://example.com" } },
      id: 1,
    }),
  });

  const response = await handleBrowserControlMcpRequest(request);
  assert.equal(response.status, 503);
  assert.equal(calls.stopInstance, 1);
  assert.equal(calls.stopServer, 0);
});

test("failed bridge creation is an error", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ healthy: true, failCreateBridge: true });

  const result = await enableBrowserControl(deps);
  assert.equal(result.status, "error");
  assert.ok(result.error!.includes("bridge exploded"));
  assert.equal(calls.bridgeCreated, 1);
});

test("a retry from error can start fresh", async () => {
  resetBrowserControlForTests();
  const { deps } = makeDeps({ healthy: false, startServerResult: null });
  await enableBrowserControl(deps);
  assert.equal(getBrowserControlState().status, "error");

  const { deps: healthyDeps, calls: healthyCalls } = makeDeps({ healthy: true });
  const retried = await enableBrowserControl(healthyDeps);
  assert.equal(retried.status, "on");
  assert.equal(healthyCalls.startServer, 0);
  assert.equal(getBrowserControlState().status, "on");
});

test("mcp requests are rejected while not enabled", async () => {
  resetBrowserControlForTests();
  const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
  });
  const response = await handleBrowserControlMcpRequest(request);
  assert.equal(response.status, 503);
});

test("mcp requests are forwarded to the bridge while on", async () => {
  resetBrowserControlForTests();
  const { deps } = makeDeps();
  await enableBrowserControl(deps);

  const request = new Request("http://127.0.0.1:3000/api/browser-control/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
  });
  const response = await handleBrowserControlMcpRequest(request);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);
});
