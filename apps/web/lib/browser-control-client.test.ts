import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BROWSER_CONTROL_HEADER,
  BrowserControlClientError,
  browserControlHeaderValue,
  disableBrowserControl,
  enableBrowserControl,
  fetchBrowserControlState,
  isBrowserControlOn,
} from "./browser-control-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withFetch(fetchStub: typeof fetch, run: () => Promise<unknown>): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("header constant matches the wire name the agent parses", () => {
  assert.equal(BROWSER_CONTROL_HEADER, "x-anchor-os-browser-control");
});

test("fetchBrowserControlState reads the live server state", async () => {
  let requestPath = "";
  let requestMethod = "";

  await withFetch(
    async (input, init) => {
      requestPath = String(input);
      requestMethod = init?.method ?? "GET";
      return jsonResponse({
        status: "on",
        profile: { id: "profile-1", name: "Anchor OS" },
      });
    },
    async () => {
      const view = await fetchBrowserControlState();
      assert.equal(view.status, "on");
      assert.equal(view.profile?.name, "Anchor OS");
    },
  );

  assert.equal(requestPath, "/api/browser-control");
  assert.equal(requestMethod, "GET");
});

test("enableBrowserControl posts enable and adopts an error state body", async () => {
  let requestPath = "";
  let requestMethod = "";
  let requestBody: string | undefined;

  await withFetch(
    async (input, init) => {
      requestPath = String(input);
      requestMethod = init?.method ?? "GET";
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return jsonResponse(
        { status: "error", error: "PinchTab server did not become healthy." },
        500,
      );
    },
    async () => {
      const view = await enableBrowserControl();
      assert.equal(view.status, "error");
      assert.equal(view.error, "PinchTab server did not become healthy.");
    },
  );

  assert.equal(requestPath, "/api/browser-control");
  assert.equal(requestMethod, "POST");
  assert.equal(requestBody, JSON.stringify({ action: "enable" }));
});

test("enableBrowserControl returns the final on state", async () => {
  await withFetch(
    async () => jsonResponse({ status: "on" }, 202),
    async () => {
      const view = await enableBrowserControl();
      assert.equal(view.status, "on");
    },
  );
});

test("disableBrowserControl posts disable and returns the off state", async () => {
  let requestBody: string | undefined;

  await withFetch(
    async (_input, init) => {
      requestBody = typeof init?.body === "string" ? init.body : undefined;
      return jsonResponse({ status: "off" });
    },
    async () => {
      const view = await disableBrowserControl();
      assert.equal(view.status, "off");
    },
  );

  assert.equal(requestBody, JSON.stringify({ action: "disable" }));
});

test("a malformed state body throws with the response status", async () => {
  await withFetch(
    async () => jsonResponse({ status: "banana" }, 200),
    async () => {
      await assert.rejects(
        fetchBrowserControlState(),
        (error: unknown) =>
          error instanceof BrowserControlClientError &&
          error.status === 200 &&
          error.message.includes("did not match the status shape"),
      );
    },
  );

  await withFetch(
    async () => jsonResponse({ nope: true }, 200),
    async () => {
      await assert.rejects(fetchBrowserControlState(), BrowserControlClientError);
    },
  );
});

test("a network failure throws with status 0", async () => {
  await withFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => {
      await assert.rejects(
        fetchBrowserControlState(),
        (error: unknown) => error instanceof BrowserControlClientError && error.status === 0,
      );
    },
  );
});

test("ready is on only while the server reports on", () => {
  assert.equal(isBrowserControlOn({ status: "on" }), true);
  assert.equal(isBrowserControlOn({ status: "off" }), false);
  assert.equal(isBrowserControlOn({ status: "starting" }), false);
  assert.equal(isBrowserControlOn({ status: "stopping" }), false);
  assert.equal(isBrowserControlOn({ status: "error", error: "boom" }), false);
});

test("the Eve header sends on only when ready", () => {
  assert.equal(browserControlHeaderValue(true), "on");
  assert.equal(browserControlHeaderValue(false), "off");
});
