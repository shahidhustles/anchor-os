import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { PinchtabMcpBridge } from "./pinchtab-mcp-bridge";
import { PINCHTAB_ALLOWED_TOOLS } from "./types";

const BLOCKED_TOOLS = [
  "pinchtab_eval",
  "pinchtab_pdf",
  "pinchtab_record",
  "pinchtab_scrape",
  "pinchtab_cookies",
  "pinchtab_cookies_set",
  "pinchtab_network",
  "pinchtab_dialog",
  "pinchtab_connect_profile",
];

const ENDPOINT = "http://127.0.0.1:3000/api/browser-control/mcp";

function allTools() {
  return [...PINCHTAB_ALLOWED_TOOLS, ...BLOCKED_TOOLS].map((name) => ({
    name,
    inputSchema: { type: "object", properties: {}, required: [] },
  }));
}

function makeUpstream(
  overrides: Partial<{
    tools: Array<{ name: string }>;
    callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<unknown>;
  }> = {},
) {
  return {
    listTools: async () => ({ tools: overrides.tools ?? allTools() }),
    callTool:
      overrides.callTool ??
      (async (params: { name: string; arguments?: Record<string, unknown> }) => ({
        content: [{ type: "text", text: `called ${params.name}` }],
      })),
    close: async () => undefined,
  } as unknown as Client;
}

async function createBridge(upstream: Client): Promise<PinchtabMcpBridge> {
  return PinchtabMcpBridge.fromDeps({ createUpstreamClient: async () => upstream });
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("advertises only allowlisted tools", async () => {
  const bridge = await createBridge(makeUpstream());
  try {
    const response = await bridge.handleRequest(
      postRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const body = (await response.json()) as {
      result?: { tools: Array<{ name: string }> };
    };
    const names = body.result!.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...PINCHTAB_ALLOWED_TOOLS].sort());
  } finally {
    await bridge.close();
  }
});

test("forwards a call to an allowlisted tool and preserves image content blocks", async () => {
  const upstream = makeUpstream({
    callTool: async (params) => {
      assert.equal(params.name, "pinchtab_screenshot");
      return {
        content: [
          { type: "text", text: "captured" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ],
      };
    },
  });
  const bridge = await createBridge(upstream);
  try {
    const response = await bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "pinchtab_screenshot", arguments: {} },
      }),
    );
    const body = (await response.json()) as { result: { content: unknown[] } };
    assert.deepEqual(body.result.content, [
      { type: "text", text: "captured" },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ]);
  } finally {
    await bridge.close();
  }
});

test("routes unscoped navigation through the existing visible tab", async () => {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const upstream = makeUpstream({
    callTool: async (params) => {
      calls.push(params);
      if (params.name === "pinchtab_list_tabs") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                tabs: [{ id: "tab_blank", url: "about:blank", title: "", type: "page" }],
              }),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: "navigated" }] };
    },
  });
  const bridge = await createBridge(upstream);
  try {
    const response = await bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "pinchtab_navigate", arguments: { url: "https://example.com" } },
      }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      { name: "pinchtab_list_tabs", arguments: {} },
      {
        name: "pinchtab_navigate",
        arguments: { url: "https://example.com", tabId: "tab_blank" },
      },
    ]);
  } finally {
    await bridge.close();
  }
});

test("re-resolves the visible tab when Chrome is reopened", async () => {
  let tabs = [{ id: "tab_first", url: "about:blank" }];
  const navigations: Array<Record<string, unknown> | undefined> = [];
  const upstream = makeUpstream({
    callTool: async (params) => {
      if (params.name === "pinchtab_list_tabs") {
        return { content: [{ type: "text", text: JSON.stringify({ tabs }) }] };
      }
      if (params.name === "pinchtab_navigate") navigations.push(params.arguments);
      return { content: [{ type: "text", text: "ok" }] };
    },
  });
  const bridge = await createBridge(upstream);
  const navigate = (id: number, url: string) =>
    bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "pinchtab_navigate", arguments: { url } },
      }),
    );

  try {
    await navigate(1, "https://example.com/first");
    tabs = [{ id: "tab_reopened", url: "about:blank" }];
    await navigate(2, "https://example.com/second");

    assert.deepEqual(navigations, [
      { url: "https://example.com/first", tabId: "tab_first" },
      { url: "https://example.com/second", tabId: "tab_reopened" },
    ]);
  } finally {
    await bridge.close();
  }
});

test("preserves an explicit navigation tab", async () => {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const bridge = await createBridge(
    makeUpstream({
      callTool: async (params) => {
        calls.push(params);
        return { content: [{ type: "text", text: "ok" }] };
      },
    }),
  );
  try {
    await bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "pinchtab_navigate",
          arguments: { url: "https://example.com", tabId: "tab_selected" },
        },
      }),
    );

    assert.deepEqual(calls, [
      {
        name: "pinchtab_navigate",
        arguments: { url: "https://example.com", tabId: "tab_selected" },
      },
    ]);
  } finally {
    await bridge.close();
  }
});

test("rejects a call to a blocked tool without forwarding it", async () => {
  let forwarded = false;
  const upstream = makeUpstream({
    callTool: async () => {
      forwarded = true;
      return { content: [] };
    },
  });
  const bridge = await createBridge(upstream);
  try {
    const response = await bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "pinchtab_eval", arguments: { expression: "1" } },
      }),
    );
    const body = (await response.json()) as { error?: { code: number; message: string } };
    assert.equal(body.error?.code, -32_601);
    assert.ok(body.error!.message.includes("pinchtab_eval"));
    assert.equal(forwarded, false);
  } finally {
    await bridge.close();
  }
});

test("a second chat is busy only while another chat has an active browser call", async () => {
  let finishFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let firstStarted: (() => void) | undefined;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const bridge = await createBridge(
    makeUpstream({
      callTool: async () => {
        firstStarted?.();
        await firstBlocked;
        return { content: [{ type: "text", text: "done" }] };
      },
    }),
  );
  try {
    const firstPromise = bridge.handleRequest(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "pinchtab_snapshot", arguments: {} },
        },
        { "x-eve-session-id": "chat-a" },
      ),
    );
    await firstStartedPromise;

    const second = await bridge.handleRequest(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "pinchtab_navigate", arguments: { url: "https://example.com" } },
        },
        { "x-eve-session-id": "chat-b" },
      ),
    );
    const secondBody = (await second.json()) as {
      result: { isError: boolean; content: Array<{ type: "text"; text: string }> };
    };
    assert.equal(secondBody.result.isError, true);
    assert.ok(secondBody.result.content[0].text.includes("busy"));

    finishFirst?.();
    const first = await firstPromise;
    const firstBody = (await first.json()) as { result: { isError?: boolean } };
    assert.notEqual(firstBody.result.isError, true);

    const after = await bridge.handleRequest(
      postRequest(
        {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "pinchtab_snapshot", arguments: {} },
        },
        { "x-eve-session-id": "chat-b" },
      ),
    );
    const afterBody = (await after.json()) as { result: { isError?: boolean } };
    assert.notEqual(afterBody.result.isError, true);
  } finally {
    finishFirst?.();
    await bridge.close();
  }
});

test("a sessioned client initializes and then lists filtered tools", async () => {
  const bridge = await createBridge(makeUpstream());
  try {
    const initResponse = await bridge.handleRequest(
      postRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    );
    const sessionId = initResponse.headers.get("mcp-session-id");
    assert.ok(sessionId !== null, "initialize returns a session id");

    const listResponse = await bridge.handleRequest(
      postRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "Mcp-Session-Id": sessionId }),
    );
    const body = (await listResponse.json()) as { result: { tools: Array<{ name: string }> } };
    const names = body.result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...PINCHTAB_ALLOWED_TOOLS].sort());
  } finally {
    await bridge.close();
  }
});

test("close tears down the upstream client", async () => {
  let closed = false;
  const upstream = makeUpstream();
  upstream.close = async () => {
    closed = true;
  };
  const bridge = await createBridge(upstream);
  await bridge.close();
  assert.equal(closed, true);
});
