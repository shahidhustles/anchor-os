import { handleBrowserControlMcpRequest } from "@anchor-os/browser-control/browser-control-server";
import { isLoopbackHost } from "@anchor-os/browser-control/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return Response.json({ error: "loopback only" }, { status: 403 });
  }
  return handleBrowserControlMcpRequest(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
