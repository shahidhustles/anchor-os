import {
  BROWSER_CONTROL_OWNER_HEADER,
  PINCHTAB_ALLOWED_TOOLS,
  type BrowserControlStatusView,
} from "@anchor-os/browser-control/types";

export const BROWSER_CONTROL_HEADER = "x-anchor-os-browser-control";
export const BROWSER_CONTROL_AUTH_ATTRIBUTE = "anchorOsBrowserControl";

export type BrowserControlSetting = "on" | "off";

const BROWSER_CONTROL_URL_ENV = "ANCHOR_BROWSER_CONTROL_URL";
const BROWSER_CONTROL_STATUS_PATH = "/api/browser-control";
const STATUS_TIMEOUT_MS = 2_000;

export type BrowserConnectionConfig = {
  url: string;
  description: string;
  headers: Record<string, string>;
  tools: { allow: string[] };
};

export type BrowserConnectionInput = {
  requested: unknown;
  status: BrowserControlStatusView;
  sessionId: string;
  env?: Record<string, string | undefined>;
};

export function parseBrowserControlHeader(value: string | null | undefined): BrowserControlSetting {
  return value?.trim().toLowerCase() === "on" ? "on" : "off";
}

export function browserControlMcpUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[BROWSER_CONTROL_URL_ENV];
  if (override !== undefined && override !== "") return override;
  return "http://127.0.0.1:3000/api/browser-control/mcp";
}

export async function fetchBrowserControlStatus(
  env: Record<string, string | undefined> = process.env,
): Promise<BrowserControlStatusView> {
  const origin = new URL(browserControlMcpUrl(env)).origin;
  try {
    const response = await fetch(`${origin}${BROWSER_CONTROL_STATUS_PATH}`, {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: "error", error: `Browser control status returned ${response.status}.` };
    }
    return (await response.json()) as BrowserControlStatusView;
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resolveBrowserConnection(input: BrowserConnectionInput): BrowserConnectionConfig | null {
  if (input.requested !== "on") return null;
  if (input.status.status !== "on") return null;
  return {
    url: browserControlMcpUrl(input.env),
    description:
      "Drive the local Anchor OS Chrome window: navigate, read the page structure, click, type, scroll, and screenshot on the user's behalf.",
    headers: { [BROWSER_CONTROL_OWNER_HEADER]: input.sessionId },
    tools: { allow: [...PINCHTAB_ALLOWED_TOOLS] },
  };
}
