import assert from "node:assert/strict";
import { test } from "node:test";

import { hasFileChanged, kindFromPath, parseScanOutput, toWorkspacePath } from "./artifact-scan";

test("parses find output lines into workspace entries", () => {
  const stdout = [
    "/workspace/Approval_Note.docx\t12345\t1770000000.5",
    "/workspace/docs/Budget.xlsx\t2048\t1770000100",
    "",
    "garbage line",
    "/workspace/notes.md\t10\t1",
    "/workspace/broken\t10\t1770000000",
  ].join("\n");

  const entries = parseScanOutput(stdout);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    absolutePath: "/workspace/Approval_Note.docx",
    path: "Approval_Note.docx",
    kind: "docx",
    sizeBytes: 12345,
    mtime: 1770000000.5,
  });
  assert.equal(entries[1]?.path, "docs/Budget.xlsx");
  assert.equal(entries[1]?.kind, "xlsx");
});

test("detects kind from path extension case-insensitively", () => {
  assert.equal(kindFromPath("Report.DOCX"), "docx");
  assert.equal(kindFromPath("a/b/data.XLSX"), "xlsx");
  assert.equal(kindFromPath("notes.md"), null);
  assert.equal(kindFromPath("archive.docx.bak"), null);
});

test("strips the workspace root from absolute paths", () => {
  assert.equal(toWorkspacePath("/workspace/Approval_Note.docx"), "Approval_Note.docx");
  assert.equal(toWorkspacePath("/workspace/a/b/c.xlsx"), "a/b/c.xlsx");
  assert.equal(toWorkspacePath("/tmp/other.docx"), "tmp/other.docx");
});

test("hasFileChanged reacts to size, mtime, and first sight", () => {
  const current = { sizeBytes: 100, mtime: 5 };
  assert.equal(hasFileChanged(undefined, current), true);
  assert.equal(hasFileChanged({ sizeBytes: 100, mtime: 5 }, current), false);
  assert.equal(hasFileChanged({ sizeBytes: 120, mtime: 5 }, current), true);
  assert.equal(hasFileChanged({ sizeBytes: 100, mtime: 6 }, current), true);
});
