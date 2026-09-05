import assert from "node:assert/strict";
import { test } from "node:test";

import { extractArtifactPaths, isArtifactToolPart } from "./artifact-utils";

test("extracts plain and quoted artifact paths from tool text", () => {
  assert.deepEqual(extractArtifactPaths("node build.js && ls -lh Approval_Note.docx"), [
    "Approval_Note.docx",
  ]);
  assert.deepEqual(extractArtifactPaths('pandoc -o "Approval Note.docx" report.md'), [
    "Approval Note.docx",
  ]);
  assert.deepEqual(extractArtifactPaths('write_file {"path": "/workspace/out.xlsx"}'), [
    "out.xlsx",
  ]);
});

test("rejects quoted shell commands that merely end in an office extension", () => {
  assert.deepEqual(
    extractArtifactPaths("sh -c 'cd node_modules && node create_petro.js && ls -lh *.docx'"),
    [],
  );
  assert.deepEqual(
    extractArtifactPaths('bash -c "ls -lh && pandoc -t markdown Approval_Note.docx"'),
    [],
  );
});

test("rejects globs and dependency directories", () => {
  assert.deepEqual(extractArtifactPaths("ls -lh '*.docx'"), []);
  assert.deepEqual(extractArtifactPaths("ls node_modules/pkg/dist/out.docx"), []);
});

test("deduplicates paths case-sensitively across a command", () => {
  assert.deepEqual(extractArtifactPaths("cat a.docx; cat sub/a.docx; cat a.docx"), [
    "a.docx",
    "sub/a.docx",
  ]);
});

test("isArtifactToolPart only matches bash and write_file tool calls", () => {
  assert.equal(
    isArtifactToolPart({ type: "tool-call", toolName: "bash", argsText: "ls Approval_Note.docx" }),
    true,
  );
  assert.equal(
    isArtifactToolPart({
      type: "tool-call",
      toolName: "ask_question",
      argsText: "What should Approval_Note.docx cover?",
    }),
    false,
  );
  assert.equal(
    isArtifactToolPart({ type: "tool-call", toolName: "read_file", argsText: "a.docx" }),
    false,
  );
});
