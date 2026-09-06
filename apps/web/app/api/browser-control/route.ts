import {
  disableBrowserControl,
  enableBrowserControl,
  getBrowserControlState,
} from "@anchor-os/browser-control/browser-control-server";
import { isLoopbackHost } from "@anchor-os/browser-control/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return Response.json({ error: "loopback only" }, { status: 403 });
  }
  return Response.json(getBrowserControlState());
}

export async function POST(request: Request): Promise<Response> {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return Response.json({ error: "loopback only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== "enable" && action !== "disable") {
    return Response.json({ error: "action must be 'enable' or 'disable'" }, { status: 400 });
  }

  try {
    const state =
      action === "enable" ? await enableBrowserControl() : await disableBrowserControl();
    const status = state.status === "error" ? 500 : state.status === "off" ? 200 : 202;
    return Response.json(state, { status });
  } catch (error) {
    return Response.json(
      { status: "error", error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
