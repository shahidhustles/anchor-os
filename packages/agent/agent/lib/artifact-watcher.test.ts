import { expect, test } from "bun:test";

import artifactWatcher, { isArtifactWritingResult } from "../hooks/artifact-watcher";

test("a completed plain reply does not wait for an artifact scan", () => {
  expect(artifactWatcher.events["message.completed"]).toBeUndefined();
  expect(artifactWatcher.events["turn.completed"]).toBeUndefined();
});

test("scans only after tools that can write workspace artifacts", () => {
  expect(isArtifactWritingResult({ kind: "tool-result", toolName: "bash" })).toBe(true);
  expect(isArtifactWritingResult({ kind: "tool-result", toolName: "write_file" })).toBe(true);
  expect(isArtifactWritingResult({ kind: "tool-result", toolName: "read_file" })).toBe(false);
  expect(isArtifactWritingResult({ kind: "tool-result", toolName: "connection_search" })).toBe(
    false,
  );
  expect(isArtifactWritingResult({ kind: "subagent-result" })).toBe(false);
});
