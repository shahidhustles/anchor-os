import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPinchtabClient } from "./pinchtab-process";
import type { PinchtabExecutor, PinchtabExecResult } from "./pinchtab-process";

function execWith(handler: (args: string[]) => PinchtabExecResult): PinchtabExecutor {
  return async (args) => handler(args);
}

const ok = (stdout: string): PinchtabExecResult => ({ stdout, stderr: "", exitCode: 0 });
const failed = (stdout = ""): PinchtabExecResult => ({
  stdout,
  stderr: "request failed",
  exitCode: 1,
});

test("checkHealth accepts a HINT line before the JSON and reports healthy", async () => {
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, ["--server", "http://127.0.0.1:9867", "health", "--json"]);
      return ok(
        `HINT: --server http://127.0.0.1:9867 is the default and can be omitted\n{"status":"ok"}`,
      );
    }),
  );
  assert.equal(await client.checkHealth("http://127.0.0.1:9867"), true);
});

test("checkHealth reports unhealthy on a failed command", async () => {
  const client = createPinchtabClient(
    execWith(() => failed("Request failed: Get ... connection refused")),
  );
  assert.equal(await client.checkHealth("http://127.0.0.1:1"), false);
});

test("startServer parses the background JSON output", async () => {
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, ["server", "--background", "--bind", "127.0.0.1"]);
      return ok(
        JSON.stringify({
          pid: 20415,
          url: "http://127.0.0.1:9867",
          token: "abc",
          logFile: "/tmp/pinchtab.log",
        }),
      );
    }),
  );
  const started = await client.startServer();
  assert.deepEqual(started, { pid: 20415, url: "http://127.0.0.1:9867", token: "abc" });
});

test("startServer returns null when a server is already running", async () => {
  const client = createPinchtabClient(
    execWith(() => ok("server already running (pid 1234); stop with: pinchtab server stop")),
  );
  assert.equal(await client.startServer(), null);
});

test("startHeadedInstance parses the instance response and pins headed mode", async () => {
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, [
        "--server",
        "http://127.0.0.1:9867",
        "instance",
        "start",
        "--profile",
        "prof_anchor",
        "--mode",
        "headed",
      ]);
      return ok(JSON.stringify({ id: "inst_1", status: "running" }));
    }),
  );
  const instance = await client.startHeadedInstance("http://127.0.0.1:9867", "prof_anchor");
  assert.deepEqual(instance, { id: "inst_1", status: "running" });
});

test("waitForInstanceRunning polls until the instance is running", async () => {
  let calls = 0;
  const client = createPinchtabClient(
    execWith(() => {
      calls += 1;
      return ok(JSON.stringify([{ id: "inst_1", status: calls >= 2 ? "running" : "starting" }]));
    }),
  );
  assert.equal(await client.waitForInstanceRunning("http://127.0.0.1:9867", "inst_1", 5_000), true);
  assert.ok(calls >= 2);
});

test("waitForInstanceRunning gives up on stopped or error states", async () => {
  const client = createPinchtabClient(
    execWith(() => ok(JSON.stringify([{ id: "inst_1", status: "error" }]))),
  );
  assert.equal(
    await client.waitForInstanceRunning("http://127.0.0.1:9867", "inst_1", 5_000),
    false,
  );
});

test("findRunningInstanceForProfile returns only a running instance for the profile", async () => {
  const client = createPinchtabClient(
    execWith(() =>
      ok(
        JSON.stringify([
          { id: "inst_stopped", profileId: "prof_anchor", status: "stopped" },
          { id: "inst_other", profileId: "prof_other", status: "running" },
          { id: "inst_anchor", profileId: "prof_anchor", status: "running" },
        ]),
      ),
    ),
  );

  assert.deepEqual(
    await client.findRunningInstanceForProfile("http://127.0.0.1:9867", "prof_anchor"),
    { id: "inst_anchor", profileId: "prof_anchor", status: "running" },
  );
});

test("findOrCreateAnchorProfile reuses an existing profile", async () => {
  let fetched = false;
  const client = createPinchtabClient(
    execWith(() =>
      ok(
        JSON.stringify([
          { id: "prof_anchor", name: "Anchor OS" },
          { id: "prof_default", name: "default" },
        ]),
      ),
    ),
    async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    },
  );
  const profile = await client.findOrCreateAnchorProfile("http://127.0.0.1:9867", "token");
  assert.deepEqual(profile, { id: "prof_anchor", name: "Anchor OS" });
  assert.equal(fetched, false);
});

test("findOrCreateAnchorProfile creates a missing profile over HTTP", async () => {
  const client = createPinchtabClient(
    execWith(() => ok(JSON.stringify([{ id: "prof_default", name: "default" }]))),
    async (input, init) => {
      assert.equal(input, "http://127.0.0.1:9867/profiles");
      assert.equal(init?.method, "POST");
      assert.equal(init?.headers?.["Authorization"], "Bearer token");
      const body = JSON.parse(String(init?.body)) as { name: string };
      assert.equal(body.name, "Anchor OS");
      return new Response(JSON.stringify({ id: "prof_new", name: "Anchor OS" }), { status: 200 });
    },
  );
  const profile = await client.findOrCreateAnchorProfile("http://127.0.0.1:9867", "token");
  assert.deepEqual(profile, { id: "prof_new", name: "Anchor OS" });
});

test("listTabs parses tab ids and urls and skips malformed entries", async () => {
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, ["--server", "http://127.0.0.1:9867", "tab", "--json"]);
      return ok(
        JSON.stringify({
          tabs: [
            { id: "tab_blank", url: "about:blank", title: "", type: "page" },
            { id: "tab_page", url: "https://example.com/", title: "Example", type: "page" },
            { id: "tab_incomplete" },
          ],
        }),
      );
    }),
  );
  const tabs = await client.listTabs("http://127.0.0.1:9867");
  assert.deepEqual(tabs, [
    { id: "tab_blank", url: "about:blank" },
    { id: "tab_page", url: "https://example.com/" },
  ]);
});

test("listTabs returns an empty list when the command fails", async () => {
  const client = createPinchtabClient(execWith(() => failed("no server")));
  assert.deepEqual(await client.listTabs("http://127.0.0.1:9867"), []);
});

test("navigateTab navigates the given tab and ignores trailing CLI text", async () => {
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, [
        "--server",
        "http://127.0.0.1:9867",
        "nav",
        "https://example.com",
        "--tab",
        "tab_blank",
        "--json",
      ]);
      return ok(
        JSON.stringify({
          route: { requestedProvider: "chrome", usedProvider: "chrome" },
          tabId: "tab_blank",
          title: "Example Domain",
          url: "https://example.com/",
        }) + "\n\nNext steps\n  pinchtab snap # See page structure\n",
      );
    }),
  );
  const tab = await client.navigateTab(
    "http://127.0.0.1:9867",
    "tab_blank",
    "https://example.com",
  );
  assert.deepEqual(tab, { id: "tab_blank", url: "https://example.com/" });
});

test("navigateTab returns null when the navigation fails", async () => {
  const client = createPinchtabClient(execWith(() => failed("Navigation timed out")));
  assert.equal(
    await client.navigateTab("http://127.0.0.1:9867", "tab_blank", "https://example.com"),
    null,
  );
});

test("readConfig reads the port, bind, and token from the config file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pinchtab-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      server: { port: "9867", bind: "127.0.0.1", token: "secret-token" },
      multiInstance: { strategy: "explicit" },
    }),
  );
  const client = createPinchtabClient(
    execWith((args) => {
      assert.deepEqual(args, ["config", "path"]);
      return ok(configPath);
    }),
  );
  const config = await client.readConfig();
  assert.deepEqual(config, {
    serverUrl: "http://127.0.0.1:9867",
    token: "secret-token",
    strategy: "explicit",
  });
});
