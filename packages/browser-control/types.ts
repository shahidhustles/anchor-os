export const BROWSER_CONTROL_PROFILE_NAME = "Anchor OS";

export const BROWSER_CONTROL_OWNER_HEADER = "x-eve-session-id";

export const BROWSER_CONTROL_HEADER = "x-anchor-os-browser-control";

export type BrowserControlStatus = "off" | "starting" | "on" | "stopping" | "error";

export type BrowserControlStatusView = {
  status: BrowserControlStatus;
  error?: string;
  profile?: { id: string; name: string };
};

export type BrowserBridge = {
  handleRequest(request: Request, parsedBody?: unknown): Promise<Response>;
  close(): Promise<void>;
};

export const PINCHTAB_ALLOWED_TOOLS = [
  "pinchtab_navigate",
  "pinchtab_back",
  "pinchtab_forward",
  "pinchtab_reload",
  "pinchtab_snapshot",
  "pinchtab_frame",
  "pinchtab_screenshot",
  "pinchtab_capture",
  "pinchtab_get_text",
  "pinchtab_find",
  "pinchtab_click",
  "pinchtab_type",
  "pinchtab_hover",
  "pinchtab_focus",
  "pinchtab_select",
  "pinchtab_scroll",
  "pinchtab_scroll_into_view",
  "pinchtab_fill",
  "pinchtab_key",
  "pinchtab_wait",
  "pinchtab_list_tabs",
  "pinchtab_close_tab",
  "pinchtab_health",
] as const;

export function isPinchtabToolAllowed(name: string): boolean {
  return (PINCHTAB_ALLOWED_TOOLS as readonly string[]).includes(name);
}

export function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}
