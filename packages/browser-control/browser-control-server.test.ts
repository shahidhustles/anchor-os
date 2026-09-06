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
import type { BrowserBridge } from "./types";

type Calls = {
  startServer: number;
  stopServer: number;
  stopInstance: number;
  bridgeClose: number;
  bridgeCreated: number;
};

function makeDeps(
  overrides: {
    healthy?: boolean;
    becomesHealthy?: boolean;
    startServerResult?: StartedPinchtabServer | null;
    instanceReady?: boolean;
    failCreateBridge?: boolean;
  } = {},
): { deps: BrowserControlDeps; calls: Calls } {
  const calls: Calls = {
    startServer: 0,
    stopServer: 0,
    stopInstance: 0,
    bridgeClose: 0,
    bridgeCreated: 0,
  };

  const pinchtab: PinchtabClient = {
    readConfig: async () => ({ serverUrl: "http://127.0.0.1:9867", token: "token" }),
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
    startHeadedInstance: async () => ({ id: "inst_anchor", status: "running" }),
    waitForInstanceRunning: async () => overrides.instanceReady ?? true,
    stopInstance: async () => {
      calls.stopInstance += 1;
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

test("starts off", () => {
  resetBrowserControlForTests();
  assert.equal(getBrowserControlState().status, "off");
});

test("enable with a healthy server reaches on without starting or stopping the server", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({ healthy: true });

  const started = await enableBrowserControl(deps);
  assert.equal(started.status, "on");
  assert.deepEqual(started.profile, { id: "prof_anchor", name: "Anchor OS" });
  assert.equal(calls.startServer, 0);
  assert.equal(calls.bridgeCreated, 1);

  const disabled = await disableBrowserControl();
  assert.equal(disabled.status, "off");
  assert.equal(calls.stopServer, 0, "must not stop a pre-existing server");
  assert.equal(calls.bridgeClose, 1);
  assert.equal(calls.stopInstance, 1, "closes the owned browser instance");
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

test("failed instance readiness cleans up the owned instance and server", async () => {
  resetBrowserControlForTests();
  const { deps, calls } = makeDeps({
    healthy: false,
    becomesHealthy: true,
    startServerResult: { pid: 1, url: "http://127.0.0.1:9867", token: "token" },
    instanceReady: false,
  });

  const result = await enableBrowserControl(deps);
  assert.equal(result.status, "error");
  assert.equal(calls.stopInstance, 1);
  assert.equal(calls.stopServer, 1);
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
