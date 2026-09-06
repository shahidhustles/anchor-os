import {
  BROWSER_CONTROL_HEADER,
  type BrowserControlStatus,
  type BrowserControlStatusView,
} from "@anchor-os/browser-control/types";

const BROWSER_CONTROL_API = "/api/browser-control";
const STATUSES: readonly string[] = ["off", "starting", "on", "stopping", "error"];

export class BrowserControlClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BrowserControlClientError";
    this.status = status;
  }
}

export { BROWSER_CONTROL_HEADER };

export function isBrowserControlOn(view: BrowserControlStatusView): boolean {
  return view.status === "on";
}

export function browserControlHeaderValue(ready: boolean): "on" | "off" {
  return ready ? "on" : "off";
}

export function fetchBrowserControlState(): Promise<BrowserControlStatusView> {
  return requestState("GET");
}

export function enableBrowserControl(): Promise<BrowserControlStatusView> {
  return requestState("POST", JSON.stringify({ action: "enable" }));
}

export function disableBrowserControl(): Promise<BrowserControlStatusView> {
  return requestState("POST", JSON.stringify({ action: "disable" }));
}

async function requestState(
  method: "GET" | "POST",
  body?: string,
): Promise<BrowserControlStatusView> {
  let response: Response;
  try {
    response = await fetch(BROWSER_CONTROL_API, {
      method,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body }),
    });
  } catch (cause: unknown) {
    throw new BrowserControlClientError(
      `browser control request failed: ${stringifyCause(cause)}`,
      0,
    );
  }
  const payload: unknown = await response.json().catch(() => null);
  const view = parseStatusView(payload);
  if (view !== null) return view;
  throw new BrowserControlClientError(
    payload === null
      ? `browser control response was not valid JSON (status ${response.status})`
      : `browser control response did not match the status shape (status ${response.status})`,
    response.status,
  );
}

function parseStatusView(value: unknown): BrowserControlStatusView | null {
  if (!isRecord(value) || !isBrowserControlStatus(value["status"])) return null;
  return {
    status: value["status"],
    ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
    ...parseProfile(value["profile"]),
  };
}

function parseProfile(
  value: unknown,
): { profile: { id: string; name: string } } | Record<string, never> {
  if (!isRecord(value) || typeof value["id"] !== "string" || typeof value["name"] !== "string") {
    return {};
  }
  return { profile: { id: value["id"], name: value["name"] } };
}

function isBrowserControlStatus(value: unknown): value is BrowserControlStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
