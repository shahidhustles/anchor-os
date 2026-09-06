import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectionReportToolkit } from "@/components/anchor-os/inspection-report-toolkit";
import {
  assertInspectionReportAttachmentMessage,
  InspectionReportAttachmentAdapter,
  INSPECTION_REPORT_MAX_BYTES,
  INSPECTION_REPORT_OPAQUE_MEDIA_TYPE,
  inspectionReportToolView,
} from "./inspection-report-attachment";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

function pdfFile(name = "Pump Inspection.pdf", type = "application/pdf"): File {
  return new File([PDF_BYTES], name, { type });
}

test("stages a PDF as opaque bytes while preserving its visible identity", async () => {
  const adapter = new InspectionReportAttachmentAdapter();
  const pending = await adapter.add({ file: pdfFile() });

  assert.equal(pending.type, "file");
  assert.equal(pending.name, "Pump Inspection.pdf");
  assert.equal(pending.contentType, "application/pdf");
  assert.deepEqual(pending.status, { type: "requires-action", reason: "composer-send" });

  const complete = await adapter.send(pending);
  assert.equal(complete.name, "Pump Inspection.pdf");
  assert.equal(complete.contentType, "application/pdf");
  assert.deepEqual(complete.status, { type: "complete" });
  assert.equal(complete.content.length, 1);

  const part = complete.content[0];
  assert.equal(part?.type, "file");
  if (part?.type !== "file") throw new Error("Expected a file content part.");
  assert.equal(part.mimeType, INSPECTION_REPORT_OPAQUE_MEDIA_TYPE);
  assert.equal(part.filename, "Pump Inspection.pdf");
  assert.ok(part.data.startsWith(`data:${INSPECTION_REPORT_OPAQUE_MEDIA_TYPE};base64,`));
  assert.deepEqual(
    new Uint8Array(Buffer.from(part.data.slice(part.data.indexOf(",") + 1), "base64")),
    PDF_BYTES,
  );
  assert.ok(!part.data.includes("application/pdf"));
});

test("rejects unsupported, empty, malformed, and oversized files", async () => {
  const adapter = new InspectionReportAttachmentAdapter();

  await assert.rejects(
    adapter.add({ file: new File(["hello"], "notes.txt", { type: "text/plain" }) }),
    /Only PDF inspection reports/,
  );
  await assert.rejects(
    adapter.add({ file: new File([], "empty.pdf", { type: "application/pdf" }) }),
    /empty/,
  );
  await assert.rejects(
    adapter.add({ file: new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }) }),
    /valid PDF signature/,
  );
  await assert.rejects(
    adapter.add({
      file: new File([new Uint8Array(INSPECTION_REPORT_MAX_BYTES + 1)], "large.pdf", {
        type: "application/pdf",
      }),
    }),
    /20 MiB or smaller/,
  );
});

test("allows only one pending report and releases the slot after removal", async () => {
  const adapter = new InspectionReportAttachmentAdapter();
  const first = await adapter.add({ file: pdfFile("first.pdf") });

  await assert.rejects(adapter.add({ file: pdfFile("second.pdf") }), /one inspection-report PDF/);
  await adapter.remove(first);
  const second = await adapter.add({ file: pdfFile("second.pdf") });

  assert.equal(second.name, "second.pdf");
});

test("validates the final Eve message attachment boundary", () => {
  const opaquePdf = {
    type: "file",
    data: "data:application/octet-stream;base64,JVBERi0=",
    mediaType: INSPECTION_REPORT_OPAQUE_MEDIA_TYPE,
    filename: "report.pdf",
  };

  assert.doesNotThrow(() => assertInspectionReportAttachmentMessage("plain message"));
  assert.doesNotThrow(() =>
    assertInspectionReportAttachmentMessage([{ type: "text", text: "Review this" }, opaquePdf]),
  );
  assert.throws(
    () =>
      assertInspectionReportAttachmentMessage([opaquePdf, { ...opaquePdf, filename: "two.pdf" }]),
    /one inspection-report PDF/,
  );
  assert.throws(
    () => assertInspectionReportAttachmentMessage([{ ...opaquePdf, mediaType: "application/pdf" }]),
    /opaque inspection-report PDF/,
  );
  assert.throws(
    () => assertInspectionReportAttachmentMessage([{ ...opaquePdf, mediaType: undefined }]),
    /opaque inspection-report PDF/,
  );
});

test("maps tool snapshots to truthful report status", () => {
  assert.deepEqual(
    inspectionReportToolView({ phase: "reading", totalPages: 3 }, { type: "running" }),
    { tone: "active", label: "Reading report · 3 pages", detail: null, retryable: false },
  );
  assert.deepEqual(
    inspectionReportToolView(
      { status: "complete", totalPages: 3, imageCount: 1 },
      { type: "complete" },
    ),
    {
      tone: "complete",
      label: "Read 3 of 3 pages",
      detail: "1 extracted image",
      retryable: false,
    },
  );
  assert.deepEqual(
    inspectionReportToolView(undefined, { type: "incomplete", reason: "cancelled" }),
    {
      tone: "cancelled",
      label: "Stopped reading report",
      detail: null,
      retryable: false,
    },
  );
  assert.deepEqual(inspectionReportToolView(undefined, { type: "incomplete", reason: "error" }), {
    tone: "error",
    label: "Could not read report",
    detail: null,
    retryable: false,
  });
});

test("maps failed tool results to a retryable or permanent error", () => {
  assert.deepEqual(
    inspectionReportToolView(
      { status: "failed", retryable: true, error: "Paddle OCR service returned HTTP 502." },
      { type: "complete" },
    ),
    {
      tone: "error",
      label: "Could not read report",
      detail: "Paddle OCR service returned HTTP 502.",
      retryable: true,
    },
  );
  assert.deepEqual(
    inspectionReportToolView(
      { status: "failed", retryable: false, error: "The staged file is not a PDF." },
      { type: "complete" },
    ),
    {
      tone: "error",
      label: "Could not read report",
      detail: "The staged file is not a PDF.",
      retryable: false,
    },
  );
  assert.deepEqual(
    inspectionReportToolView(
      { error: "backend rejected the call" },
      { type: "incomplete", reason: "error" },
    ),
    {
      tone: "error",
      label: "Could not read report",
      detail: "backend rejected the call",
      retryable: false,
    },
  );
});

test("registers the OCR tool renderer as a standalone backend tool", () => {
  const tool = inspectionReportToolkit.parse_inspection_report;

  assert.equal(tool.type, "backend");
  assert.equal(tool.display, "standalone");
  assert.equal(typeof tool.render, "function");
});
