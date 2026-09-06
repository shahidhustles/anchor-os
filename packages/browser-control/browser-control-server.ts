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
        env: { PINCHTAB_TOKEN: token, ...process.env },
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
    state: { status: "off", serverOwned: false },
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
    const { serverUrl, token } = await rt.deps.pinchtab.readConfig();
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
      if (!(await rt.deps.pinchtab.waitForHealthy(started.url))) {
        throw new Error("PinchTab server did not become healthy.");
      }
    }

    const profile = await rt.deps.pinchtab.findOrCreateAnchorProfile(state.serverUrl, token);
    state.profile = profile;

    const instance = await rt.deps.pinchtab.startHeadedInstance(state.serverUrl, profile.id);
    if (instance === null) {
      throw new Error("Could not start the headed browser instance.");
    }
    state.instanceId = instance.id;
    if (!(await rt.deps.pinchtab.waitForInstanceRunning(state.serverUrl, instance.id))) {
      throw new Error("The browser instance did not become ready.");
    }

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
  const { state } = runtime();
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
  if (state.bridge !== undefined) {
    await state.bridge.close().catch(() => undefined);
    state.bridge = undefined;
  }
  if (state.instanceId !== undefined && state.serverUrl !== undefined) {
    await deps.pinchtab.stopInstance(state.serverUrl, state.instanceId).catch(() => undefined);
    state.instanceId = undefined;
  }
  if (state.serverOwned && state.serverUrl !== undefined) {
    await deps.pinchtab.stopServer(state.serverUrl).catch(() => undefined);
    state.serverOwned = false;
  }
}
