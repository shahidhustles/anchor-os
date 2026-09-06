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

test("readConfig reads the port, bind, and token from the config file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pinchtab-config-"));
  const configPath = join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      server: { port: "9867", bind: "127.0.0.1", token: "secret-token" },
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
  });
});
