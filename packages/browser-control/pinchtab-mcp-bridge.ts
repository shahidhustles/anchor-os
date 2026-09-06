import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  isInitializeRequest,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";

import { BROWSER_CONTROL_OWNER_HEADER, isPinchtabToolAllowed } from "./types";

export const ANONYMOUS_OWNER = "__anonymous__";

export type PinchtabMcpBridgeOptions = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export type PinchtabMcpBridgeDeps = {
  createUpstreamClient: () => Promise<Client>;
};

const BRIDGE_SERVER_INFO = { name: "anchor-browser-control", version: "1.0.0" } as const;

export class PinchtabMcpBridge {
  private readonly sessions = new Map<
    string,
    { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
  >();
  private ownerSessionId: string | undefined;
  private activeOwnerCalls = 0;
  private anchoredTabId: string | undefined;
  private closed = false;

  private constructor(private readonly upstream: Client) {}

  static async create(options: PinchtabMcpBridgeOptions): Promise<PinchtabMcpBridge> {
    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args,
      env: options.env,
    });
    const upstream = new Client({
      name: BRIDGE_SERVER_INFO.name,
      version: BRIDGE_SERVER_INFO.version,
    });
    await upstream.connect(transport);
    return new PinchtabMcpBridge(upstream);
  }

  static fromDeps(deps: PinchtabMcpBridgeDeps): Promise<PinchtabMcpBridge> {
    return deps.createUpstreamClient().then((upstream) => new PinchtabMcpBridge(upstream));
  }

  async handleRequest(request: Request, parsedBody?: unknown): Promise<Response> {
    if (this.closed) {
      return jsonRpcErrorResponse(404, -32_001, "Session not found");
    }

    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId === null ? undefined : this.sessions.get(sessionId);

    if (session !== undefined) {
      return session.transport.handleRequest(request, { parsedBody });
    }

    if (sessionId !== null) {
      return jsonRpcErrorResponse(404, -32_001, "Session not found");
    }

    if (await isInitializeBody(request, parsedBody)) {
      const sessioned = await this.createSessionedTransport();
      return sessioned.transport.handleRequest(request, { parsedBody });
    }

    const stateless = await this.createStatelessTransport();
    return stateless.transport.handleRequest(request, { parsedBody });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled(
      [...this.sessions.values()].map(async ({ server, transport }) => {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }),
    );
    this.sessions.clear();
    await this.upstream.close().catch(() => undefined);
  }

  private async createSessionedTransport(): Promise<{
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
  }> {
    const server = this.createFilteredServer();
    let transport: WebStandardStreamableHTTPServerTransport;
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        this.sessions.set(id, { server, transport });
      },
    });
    await server.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId !== undefined) this.sessions.delete(transport.sessionId);
    };
    return { server, transport };
  }

  private async createStatelessTransport(): Promise<{
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
  }> {
    const server = this.createFilteredServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return { server, transport };
  }

  private createFilteredServer(): McpServer {
    const upstream = this.upstream;
    const server = new McpServer(BRIDGE_SERVER_INFO, { capabilities: { tools: {} } });

    server.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const { tools } = await upstream.listTools();
      return { tools: tools.filter((tool) => isPinchtabToolAllowed(tool.name)) };
    });

    server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      if (!isPinchtabToolAllowed(request.params.name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not allowed: ${request.params.name}`);
      }
      const owner = this.acquireOwner(readOwnerHeader(extra));
      if (typeof owner === "string") {
        return { content: [{ type: "text", text: owner }], isError: true };
      }
      try {
        const toolArguments = await this.routeToolArguments(
          request.params.name,
          request.params.arguments,
        );
        const result = await upstream.callTool({
          name: request.params.name,
          arguments: toolArguments,
        });
        if (request.params.name === "pinchtab_close_tab" && !isToolError(result)) {
          this.anchoredTabId = undefined;
        }
        return result;
      } finally {
        owner.release();
      }
    });

    return server;
  }

  private async routeToolArguments(
    toolName: string,
    toolArguments: Record<string, unknown> | undefined,
  ): Promise<Record<string, unknown> | undefined> {
    if (toolName !== "pinchtab_navigate") return toolArguments;

    const explicitTabId = readNonEmptyString(toolArguments?.tabId);
    if (explicitTabId !== undefined) {
      this.anchoredTabId = explicitTabId;
      return toolArguments;
    }

    const tabsResult = await this.upstream.callTool({
      name: "pinchtab_list_tabs",
      arguments: {},
    });
    const tabs = readTabs(tabsResult);
    if (tabs === undefined) {
      if (this.anchoredTabId !== undefined) return toolArguments;
      throw new McpError(
        ErrorCode.InternalError,
        "Could not find the visible Chrome tab before navigation.",
      );
    }

    if (this.anchoredTabId !== undefined && tabs.some((tab) => tab.id === this.anchoredTabId)) {
      return toolArguments;
    }

    const target = tabs.find((tab) => isBlankTabUrl(tab.url)) ?? tabs[0];
    if (target === undefined) return toolArguments;

    this.anchoredTabId = target.id;
    return { ...toolArguments, tabId: target.id };
  }

  private acquireOwner(eveSessionId: string | undefined): { release: () => void } | string {
    const caller =
      eveSessionId === undefined || eveSessionId === "" ? ANONYMOUS_OWNER : eveSessionId;
    if (this.ownerSessionId === undefined) {
      this.ownerSessionId = caller;
      this.activeOwnerCalls = 1;
      return { release: () => this.releaseOwner(caller) };
    }
    if (this.ownerSessionId !== caller) {
      return "Browser control is busy: another chat is using the browser. Try again once that chat finishes.";
    }
    this.activeOwnerCalls += 1;
    return { release: () => this.releaseOwner(caller) };
  }

  private releaseOwner(caller: string): void {
    if (this.ownerSessionId !== caller) return;
    this.activeOwnerCalls -= 1;
    if (this.activeOwnerCalls > 0) return;
    this.activeOwnerCalls = 0;
    this.ownerSessionId = undefined;
  }
}

type PinchtabTab = { id: string; url: string };

function readTabs(result: unknown): PinchtabTab[] | undefined {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content)) {
    return undefined;
  }

  for (const block of result.content) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (!isRecord(parsed) || !Array.isArray(parsed.tabs)) continue;
      const tabs = parsed.tabs.flatMap((tab): PinchtabTab[] => {
        if (!isRecord(tab) || typeof tab.id !== "string" || typeof tab.url !== "string") return [];
        return [{ id: tab.id, url: tab.url }];
      });
      return tabs;
    } catch {
      continue;
    }
  }
  return undefined;
}

function isToolError(result: unknown): boolean {
  return isRecord(result) && result.isError === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isBlankTabUrl(url: string): boolean {
  return url === "" || url === "about:blank" || url.startsWith("chrome://newtab");
}

async function isInitializeBody(
  request: Request,
  parsedBody: unknown | undefined,
): Promise<boolean> {
  if (parsedBody !== undefined) {
    return Array.isArray(parsedBody)
      ? parsedBody.some((message) => isInitializeRequest(message))
      : isInitializeRequest(parsedBody);
  }
  try {
    const body = await request.clone().json();
    return Array.isArray(body)
      ? body.some((message) => isInitializeRequest(message))
      : isInitializeRequest(body);
  } catch {
    return false;
  }
}

function readOwnerHeader(extra: {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
}): string | undefined {
  const value = extra.requestInfo?.headers?.[BROWSER_CONTROL_OWNER_HEADER];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcErrorResponse(httpStatus: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status: httpStatus, headers: { "Content-Type": "application/json" } },
  );
}
