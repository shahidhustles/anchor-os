import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

import { BROWSER_CONTROL_PROFILE_NAME } from "./types";

export const PINCHTAB_BINARY = "pinchtab";

export type PinchtabExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type PinchtabExecutor = (
  args: string[],
  options?: { timeoutMs?: number },
) => Promise<PinchtabExecResult>;

export type PinchtabConfig = {
  serverUrl: string;
  token: string;
};

export type PinchtabProfile = {
  id: string;
  name: string;
};

export type PinchtabInstance = {
  id: string;
  status: string;
};

export type StartedPinchtabServer = {
  pid: number;
  url: string;
  token: string;
};

export type PinchtabClient = {
  readConfig(): Promise<PinchtabConfig>;
  checkHealth(serverUrl: string): Promise<boolean>;
  waitForHealthy(serverUrl: string, timeoutMs?: number): Promise<boolean>;
  startServer(): Promise<StartedPinchtabServer | null>;
  stopServer(serverUrl: string): Promise<void>;
  findOrCreateAnchorProfile(serverUrl: string, token: string): Promise<PinchtabProfile>;
  startHeadedInstance(serverUrl: string, profileId: string): Promise<PinchtabInstance | null>;
  waitForInstanceRunning(
    serverUrl: string,
    instanceId: string,
    timeoutMs?: number,
  ): Promise<boolean>;
  stopInstance(serverUrl: string, instanceId: string): Promise<void>;
};

export function createPinchtabExecutor(): PinchtabExecutor {
  return (args, options) =>
    new Promise((resolve) => {
      execFile(
        PINCHTAB_BINARY,
        args,
        { encoding: "utf8", timeout: options?.timeoutMs ?? 30_000 },
        (error, stdout, stderr) => {
          const exitCode = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
          resolve({ stdout, stderr, exitCode });
        },
      );
    });
}

export function createPinchtabClient(
  executor: PinchtabExecutor = createPinchtabExecutor(),
  fetchImpl: typeof fetch = fetch,
): PinchtabClient {
  return {
    async readConfig() {
      const result = await executor(["config", "path"]);
      if (result.exitCode !== 0) {
        throw new Error("pinchtab is not installed or its config could not be read");
      }
      const config = JSON.parse((await readFile(result.stdout.trim(), "utf8")).trim()) as {
        server?: { port?: string | number; bind?: string; token?: string };
      };
      const port = config.server?.port ?? "9867";
      const bind = config.server?.bind ?? "127.0.0.1";
      const token = config.server?.token ?? "";
      return { serverUrl: `http://${bind}:${port}`, token };
    },

    async checkHealth(serverUrl) {
      const result = await executor(["--server", serverUrl, "health", "--json"]);
      if (result.exitCode !== 0) return false;
      try {
        return parseJsonObject(result.stdout).status === "ok";
      } catch {
        return false;
      }
    },

    async waitForHealthy(serverUrl, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await this.checkHealth(serverUrl)) return true;
        await sleep(1_000);
      }
      return false;
    },

    async startServer() {
      const result = await executor(["server", "--background", "--bind", "127.0.0.1"], {
        timeoutMs: 60_000,
      });
      if (result.exitCode !== 0) return null;
      if (result.stdout.includes("server already running")) return null;
      try {
        const parsed = parseJsonObject(result.stdout);
        return {
          pid: parsed.pid as number,
          url: parsed.url as string,
          token: parsed.token as string,
        };
      } catch {
        return null;
      }
    },

    async stopServer(serverUrl) {
      await executor(["--server", serverUrl, "server", "stop"]);
    },

    async findOrCreateAnchorProfile(serverUrl, token) {
      const existing = (await listProfiles(executor, serverUrl)).find(
        (profile) => profile.name === BROWSER_CONTROL_PROFILE_NAME,
      );
      if (existing !== undefined) return existing;

      const response = await fetchImpl(`${serverUrl}/profiles`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: BROWSER_CONTROL_PROFILE_NAME }),
      });
      if (!response.ok) {
        throw new Error(
          `Could not create the ${BROWSER_CONTROL_PROFILE_NAME} profile (${response.status})`,
        );
      }
      const parsed = (await response.json()) as { id: string; name: string };
      return { id: parsed.id, name: parsed.name };
    },

    async startHeadedInstance(serverUrl, profileId) {
      const result = await executor([
        "--server",
        serverUrl,
        "instance",
        "start",
        "--profile",
        profileId,
        "--mode",
        "headed",
      ]);
      if (result.exitCode !== 0) return null;
      try {
        const parsed = parseJsonObject(result.stdout);
        return { id: parsed.id as string, status: parsed.status as string };
      } catch {
        return null;
      }
    },

    async waitForInstanceRunning(serverUrl, instanceId, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const instance = await findInstance(executor, serverUrl, instanceId);
        if (instance !== null) {
          if (instance.status === "running") return true;
          if (instance.status === "stopped" || instance.status === "error") return false;
        }
        await sleep(1_000);
      }
      return false;
    },

    async stopInstance(serverUrl, instanceId) {
      await executor(["--server", serverUrl, "instance", "stop", instanceId]);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listProfiles(
  executor: PinchtabExecutor,
  serverUrl: string,
): Promise<PinchtabProfile[]> {
  const result = await executor(["--server", serverUrl, "profiles", "--json"]);
  if (result.exitCode !== 0) return [];
  try {
    const parsed = parseJsonArray(result.stdout);
    return parsed.map((profile) => ({
      id: String(profile.id),
      name: String(profile.name),
    }));
  } catch {
    return [];
  }
}

async function findInstance(
  executor: PinchtabExecutor,
  serverUrl: string,
  instanceId: string,
): Promise<PinchtabInstance | null> {
  const result = await executor(["--server", serverUrl, "instance", "list", "--json"]);
  if (result.exitCode !== 0) return null;
  try {
    const parsed = parseJsonArray(result.stdout);
    const instance = parsed.find((entry) => entry.id === instanceId);
    return instance === undefined
      ? null
      : { id: String(instance.id), status: String(instance.status) };
  } catch {
    return null;
  }
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  return JSON.parse(extractJson(stdout)) as Record<string, unknown>;
}

function parseJsonArray(stdout: string): Array<Record<string, unknown>> {
  return JSON.parse(extractJson(stdout)) as Array<Record<string, unknown>>;
}

function extractJson(stdout: string): string {
  const text = stdout.trim();
  const start = Math.min(
    ...["{", "["].map((marker) => {
      const index = text.indexOf(marker);
      return index === -1 ? text.length : index;
    }),
  );
  return start === 0 ? text : text.slice(start);
}
