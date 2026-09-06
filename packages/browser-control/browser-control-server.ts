import { createPinchtabClient, PINCHTAB_BINARY } from "./pinchtab-process";
import type { PinchtabClient, PinchtabProfile } from "./pinchtab-process";
import { PinchtabMcpBridge } from "./pinchtab-mcp-bridge";
import type { BrowserBridge, BrowserControlStatus, BrowserControlStatusView } from "./types";

export type BrowserControlDeps = {
  pinchtab: PinchtabClient;
  createBridge: (serverUrl: string, token: string) => Promise<BrowserBridge>;
};

export function createBrowserControlDeps(): BrowserControlDeps {
  const client = createPinchtabClient();
  return {
    pinchtab: client,
    createBridge: (serverUrl, token) =>
      PinchtabMcpBridge.create({
        command: PINCHTAB_BINARY,
        args: ["mcp", "--server", serverUrl],
        env: { ...process.env, PINCHTAB_TOKEN: token },
      }),
  };
}

type RuntimeState = {
  status: BrowserControlStatus;
  error?: string;
  serverUrl?: string;
  serverOwned: boolean;
  profile?: PinchtabProfile;
  instanceId?: string;
  instanceOwned: boolean;
  instanceStart?: Promise<void>;
  bridge?: BrowserBridge;
};

type BrowserControlRuntime = {
  state: RuntimeState;
  deps: BrowserControlDeps;
};

const GLOBAL_KEY = "__anchorBrowserControl";

function runtime(): BrowserControlRuntime {
  const global = globalThis as unknown as Record<string, BrowserControlRuntime | undefined>;
  global[GLOBAL_KEY] ??= {
    state: { status: "off", serverOwned: false, instanceOwned: false },
    deps: createBrowserControlDeps(),
  };
  return global[GLOBAL_KEY]!;
}

export function getBrowserControlState(): BrowserControlStatusView {
  const { state } = runtime();
  return publicState(state);
}

export async function enableBrowserControl(
  deps?: BrowserControlDeps,
): Promise<BrowserControlStatusView> {
  const rt = runtime();
  if (deps !== undefined) rt.deps = deps;
  const { state } = rt;

  if (state.status === "starting") {
    return { ...publicState(state), error: "Browser control is already starting." };
  }
  if (state.status === "on") {
    return publicState(state);
  }
  if (state.status === "stopping") {
    return { status: "error", error: "Browser control is stopping; try again shortly." };
  }

  state.status = "starting";
  state.error = undefined;
  try {
    const { serverUrl, token: configuredToken, strategy } = await rt.deps.pinchtab.readConfig();
    if (strategy !== "explicit") {
      throw new Error(
        `PinchTab must use the explicit strategy for on-demand browser startup; found ${strategy}.`,
      );
    }
    let token = configuredToken;
    state.serverUrl = serverUrl;

    if (await rt.deps.pinchtab.checkHealth(serverUrl)) {
      state.serverOwned = false;
    } else {
      const started = await rt.deps.pinchtab.startServer();
      if (started === null) {
        throw new Error("Could not start PinchTab. Is pinchtab installed and running?");
      }
      state.serverOwned = true;
      state.serverUrl = started.url;
      token = started.token || configuredToken;
      if (!(await rt.deps.pinchtab.waitForHealthy(started.url))) {
        throw new Error("PinchTab server did not become healthy.");
      }
    }

    const profile = await rt.deps.pinchtab.findOrCreateAnchorProfile(state.serverUrl, token);
    state.profile = profile;

    state.bridge = await rt.deps.createBridge(state.serverUrl, token);
    state.status = "on";
    return publicState(state);
  } catch (error) {
    state.status = "error";
    state.error = error instanceof Error ? error.message : String(error);
    await cleanupOwned(rt);
    return publicState(state);
  }
}

export async function disableBrowserControl(): Promise<BrowserControlStatusView> {
  const rt = runtime();
  const { state } = rt;

  if (state.status === "off") {
    return publicState(state);
  }
  if (state.status === "starting") {
    return { ...publicState(state), error: "Browser control is still starting; wait and retry." };
  }

  state.status = "stopping";
  await cleanupOwned(rt);
  state.status = "off";
  state.error = undefined;
  return publicState(state);
}

export async function handleBrowserControlMcpRequest(request: Request): Promise<Response> {
  const rt = runtime();
  const { state } = rt;
  if (state.status !== "on" || state.bridge === undefined) {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32_000, message: "Browser control is not enabled." },
        id: null,
      },
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  if (await isBrowserToolCall(request)) {
    try {
      await ensureHeadedInstance(rt);
    } catch (error) {
      return jsonRpcUnavailable(
        error instanceof Error ? error.message : "Could not start the headed browser instance.",
      );
    }
  }
  if (state.status !== "on" || state.bridge === undefined)
    return jsonRpcUnavailable("Browser control was disabled.");
  return state.bridge.handleRequest(request);
}

export function resetBrowserControlForTests(): void {
  const global = globalThis as unknown as Record<string, BrowserControlRuntime | undefined>;
  delete global[GLOBAL_KEY];
}

function publicState(state: RuntimeState): BrowserControlStatusView {
  return {
    status: state.status,
    error: state.error,
    profile: state.profile,
  };
}

async function cleanupOwned(rt: BrowserControlRuntime): Promise<void> {
  const { state, deps } = rt;
  await state.instanceStart?.catch(() => undefined);
  if (state.bridge !== undefined) {
    await state.bridge.close().catch(() => undefined);
    state.bridge = undefined;
  }
  if (state.instanceOwned && state.instanceId !== undefined && state.serverUrl !== undefined) {
    await deps.pinchtab.stopInstance(state.serverUrl, state.instanceId).catch(() => undefined);
  }
  state.instanceId = undefined;
  state.instanceOwned = false;
  if (state.serverOwned && state.serverUrl !== undefined) {
    await deps.pinchtab.stopServer(state.serverUrl).catch(() => undefined);
    state.serverOwned = false;
  }
}

async function ensureHeadedInstance(rt: BrowserControlRuntime): Promise<void> {
  const existingStart = rt.state.instanceStart;
  if (existingStart !== undefined) return existingStart;

  const start = startOrReuseHeadedInstance(rt);
  rt.state.instanceStart = start;
  try {
    await start;
  } finally {
    if (rt.state.instanceStart === start) rt.state.instanceStart = undefined;
  }
}

async function startOrReuseHeadedInstance(rt: BrowserControlRuntime): Promise<void> {
  const { state, deps } = rt;
  if (state.serverUrl === undefined || state.profile === undefined) {
    throw new Error("Browser control is not ready.");
  }

  const running = await deps.pinchtab.findRunningInstanceForProfile(
    state.serverUrl,
    state.profile.id,
  );
  if (running !== null) {
    if (state.instanceId !== running.id) state.instanceOwned = false;
    state.instanceId = running.id;
    return;
  }

  state.instanceId = undefined;
  state.instanceOwned = false;
  const instance = await deps.pinchtab.startHeadedInstance(state.serverUrl, state.profile.id);
  if (instance === null) throw new Error("Could not start the headed browser instance.");
  state.instanceId = instance.id;
  state.instanceOwned = true;
  if (await deps.pinchtab.waitForInstanceRunning(state.serverUrl, instance.id)) return;

  await deps.pinchtab.stopInstance(state.serverUrl, instance.id).catch(() => undefined);
  state.instanceId = undefined;
  state.instanceOwned = false;
  throw new Error("The browser instance did not become ready.");
}

async function isBrowserToolCall(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  try {
    const body: unknown = await request.clone().json();
    const messages = Array.isArray(body) ? body : [body];
    return messages.some((message) => {
      if (!isRecord(message) || message["method"] !== "tools/call") return false;
      const params = message["params"];
      if (!isRecord(params)) return false;
      return params["name"] !== "pinchtab_health";
    });
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRpcUnavailable(message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32_000, message }, id: null },
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}
