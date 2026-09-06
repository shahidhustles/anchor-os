import { afterEach, expect, test } from "bun:test";

import type {
  InspectionReportResult,
  InspectionReportSandbox,
  InspectionReportProgress,
} from "./inspection-report";
import {
  assembleInspectionReport,
  deriveReportId,
  INSPECTION_REPORT_MAX_PAGES,
  parseInspectionReport,
  parsePdfInfoPages,
  rewriteMarkdownImageReferences,
  slugifyFilename,
  validateStagedPdf,
} from "./inspection-report";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.PADDLE_OCR_BASE_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) delete process.env.PADDLE_OCR_BASE_URL;
  else process.env.PADDLE_OCR_BASE_URL = originalBaseUrl;
});

const STAGED_PATH = "/workspace/attachments/abc123/pump-inspection.pdf";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PDF_BASE64 = Buffer.from(PDF_BYTES).toString("base64");
const IMAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const IMAGE_BASE64 = Buffer.from(IMAGE_BYTES).toString("base64");

type FakeSandboxOptions = {
  readonly pdfinfoPages?: number;
  readonly pdfinfoExitCode?: number;
  readonly pdfinfoStderr?: string;
};

function createFakeSandbox(
  files: Map<string, Uint8Array | string>,
  options: FakeSandboxOptions = {},
): { readonly sandbox: InspectionReportSandbox; readonly commands: string[] } {
  const commands: string[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const sandbox: InspectionReportSandbox = {
    resolvePath: (path) => (path.startsWith("/") ? path : `/workspace/${path}`),
    run: async ({ command }) => {
      commands.push(command);
      if (command.startsWith("pdfinfo ")) {
        return {
          exitCode: options.pdfinfoExitCode ?? 0,
          stdout: `Title: test\nPages:         ${options.pdfinfoPages ?? 2}\nEncrypted: no\n`,
          stderr: options.pdfinfoStderr ?? "",
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
    readBinaryFile: async ({ path }) => {
      const value = files.get(path);
      return value instanceof Uint8Array ? value : null;
    },
    readTextFile: async ({ path }) => {
      const value = files.get(path);
      if (value === undefined) return null;
      return typeof value === "string" ? value : decoder.decode(value);
    },
    writeBinaryFile: async ({ path, content }) => {
      files.set(path, content);
    },
    writeTextFile: async ({ path, content }) => {
      files.set(path, encoder.encode(content));
    },
    removePath: async ({ path }) => {
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  };
  return { sandbox, commands };
}

function paddleSuccessPayload(): Record<string, unknown> {
  return {
    logId: "log-1",
    errorCode: 0,
    errorMsg: "Success",
    result: {
      dataInfo: { type: "pdf", numPages: 2, pages: [{ pageNumber: 1 }, { pageNumber: 2 }] },
      layoutParsingResults: [
        {
          prunedResult: { page_number: 1 },
          markdown: {
            text: "# Pump P-204A\n\n![photo](imgs/img_001.jpg)\n\n| Bearing Temp | 86 C |",
            images: { "imgs/img_001.jpg": IMAGE_BASE64 },
          },
        },
        {
          prunedResult: { page_number: 2 },
          markdown: { text: "Abnormal vibration near DE bearing.", images: {} },
        },
      ],
    },
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function drain(
  generator: AsyncGenerator<InspectionReportProgress | InspectionReportResult, void, void>,
): Promise<(InspectionReportProgress | InspectionReportResult)[]> {
  const yielded: (InspectionReportProgress | InspectionReportResult)[] = [];
  for (;;) {
    const { value, done } = await generator.next();
    if (done) return yielded;
    yielded.push(value);
  }
}

function stagedFiles(): Map<string, Uint8Array | string> {
  const files = new Map<string, Uint8Array | string>();
  files.set(STAGED_PATH, PDF_BYTES);
  return files;
}

function storedText(files: Map<string, Uint8Array | string>, path: string): string {
  const value = files.get(path);
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  throw new Error(`no stored file at ${path}`);
}

test("parses one staged PDF into a complete report directory", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox, commands } = createFakeSandbox(files);
  let paddleRequests = 0;
  globalThis.fetch = (async () => {
    paddleRequests += 1;
    return jsonResponse(paddleSuccessPayload());
  }) as typeof fetch;

  const yielded = await drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }));

  const result = yielded.at(-1) as InspectionReportResult;
  expect(yielded.slice(0, 3)).toEqual([
    { phase: "validating", filename: "pump-inspection.pdf", sizeBytes: PDF_BYTES.byteLength },
    { phase: "reading", totalPages: 2 },
    { phase: "saving", totalPages: 2, imageCount: 1 },
  ]);
  expect(result.status).toBe("complete");
  expect(result.cached).toBe(false);
  expect(result.totalPages).toBe(2);
  expect(result.imageCount).toBe(1);
  expect(result.logId).toBe("log-1");

  const reportId = deriveReportId("pump-inspection.pdf", PDF_BYTES);
  const reportDir = `inspection-reports/${reportId}`;
  expect(result.reportId).toBe(reportId);
  expect(result.reportDir).toBe(`/workspace/${reportDir}`);
  expect(result.originalPath).toBe(`/workspace/${reportDir}/original.pdf`);
  expect(result.reportPath).toBe(`/workspace/${reportDir}/report.md`);
  expect(result.layoutPath).toBe(`/workspace/${reportDir}/layout.json`);
  expect(result.manifestPath).toBe(`/workspace/${reportDir}/manifest.json`);
  expect(result.imagePaths).toEqual([`/workspace/${reportDir}/images/page-001-image-001.jpg`]);

  expect(commands).toHaveLength(1);
  expect(commands[0]).toContain("pdfinfo '/workspace/attachments/abc123/pump-inspection.pdf'");
  expect(paddleRequests).toBe(1);

  expect(files.get(`${reportDir}/original.pdf`)).toEqual(PDF_BYTES);
  const report = storedText(files, `${reportDir}/report.md`);
  expect(report).toContain("<!-- page 1 -->");
  expect(report).toContain("<!-- page 2 -->");
  expect(report).toContain("](images/page-001-image-001.jpg)");
  expect(report).not.toContain("imgs/img_001.jpg");
  expect(files.get(`${reportDir}/images/page-001-image-001.jpg`)).toEqual(IMAGE_BYTES);

  const layout = JSON.parse(storedText(files, `${reportDir}/layout.json`)) as {
    pages: { page: number; result: Record<string, unknown> }[];
  };
  expect(layout.schemaVersion).toBe(1);
  expect(layout.reportId).toBe(reportId);
  expect(layout.pages.map((page) => page.page)).toEqual([1, 2]);
  expect(layout.pages[0]!.result).toEqual({ page_number: 1 });
  expect(layout.pages[1]!.result).toEqual({ page_number: 2 });

  const manifest = JSON.parse(storedText(files, `${reportDir}/manifest.json`)) as {
    schemaVersion: number;
    pageCount: number;
    paddleResultCount: number;
    ocr: { status: string; logId: string; requestedAt: string };
    source: { filename: string; sha256: string; sizeBytes: number };
    images: Record<string, unknown>[];
  };
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.reportId).toBe(reportId);
  expect(manifest.pageCount).toBe(2);
  expect(manifest.paddleResultCount).toBe(2);
  expect(manifest.ocr.status).toBe("complete");
  expect(manifest.ocr.logId).toBe("log-1");
  expect(manifest.source.filename).toBe("pump-inspection.pdf");
  expect(manifest.source.sizeBytes).toBe(PDF_BYTES.byteLength);
  expect(manifest.images[0]).toMatchObject({
    path: "images/page-001-image-001.jpg",
    mediaType: "image/jpeg",
    sourcePage: 1,
    originalKey: "imgs/img_001.jpg",
    label: "photo",
    boundingBox: null,
  });

  expect(JSON.stringify(yielded)).not.toContain(PDF_BASE64);
  expect(JSON.stringify(yielded)).not.toContain(IMAGE_BASE64);
});

test("reuses the completed directory for the same source bytes", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox, commands } = createFakeSandbox(files);
  let paddleRequests = 0;
  globalThis.fetch = (async () => {
    paddleRequests += 1;
    return jsonResponse(paddleSuccessPayload());
  }) as typeof fetch;

  await drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }));
  expect(paddleRequests).toBe(1);

  const yielded = await drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }));

  const result = yielded.at(-1) as InspectionReportResult;
  expect(yielded.slice(0, 2)).toEqual([
    { phase: "validating", filename: "pump-inspection.pdf", sizeBytes: PDF_BYTES.byteLength },
    result,
  ]);
  expect(result.cached).toBe(true);
  expect(result.status).toBe("complete");
  expect(result.totalPages).toBe(2);
  expect(result.imageCount).toBe(1);
  expect(paddleRequests).toBe(1);
  expect(commands).toHaveLength(1);
});

test("refuses to overwrite a directory holding different source bytes", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox } = createFakeSandbox(files);
  const reportId = deriveReportId("pump-inspection.pdf", PDF_BYTES);
  const manifestPath = `inspection-reports/${reportId}/manifest.json`;
  const existingManifest = JSON.stringify({
    reportId,
    pageCount: 2,
    source: { sha256: "deadbeefdeadbeefdeadbeefdeadbeef" },
    ocr: { logId: "old-log" },
    images: [],
  });
  files.set(manifestPath, existingManifest);
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /different source bytes/,
  );
  expect(files.get(manifestPath)).toBe(existingManifest);
});

test("a page-count mismatch publishes no complete report artifacts", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox } = createFakeSandbox(files, { pdfinfoPages: 3 });
  globalThis.fetch = (async () => jsonResponse(paddleSuccessPayload())) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /disagrees with the locally counted 3 pages/,
  );

  const reportId = deriveReportId("pump-inspection.pdf", PDF_BYTES);
  const reportDir = `inspection-reports/${reportId}`;
  expect(files.get(`${reportDir}/original.pdf`)).toEqual(PDF_BYTES);
  expect(files.has(`${reportDir}/report.md`)).toBe(false);
  expect(files.has(`${reportDir}/layout.json`)).toBe(false);
  expect(files.has(`${reportDir}/manifest.json`)).toBe(false);
});

test("rejects files without a PDF signature", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = new Map<string, Uint8Array | string>([
    [STAGED_PATH, new TextEncoder().encode("not a pdf")],
  ]);
  const { sandbox, commands } = createFakeSandbox(files);
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /%PDF- signature/,
  );
  expect(commands).toHaveLength(0);
});

test("rejects oversized PDFs", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const { sandbox, commands } = createFakeSandbox(stagedFiles());
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(
    drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH, maxInputBytes: 4 })),
  ).rejects.toThrow(/limit/);
  expect(commands).toHaveLength(0);
});

test("rejects PDFs above the page limit", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox, commands } = createFakeSandbox(files, {
    pdfinfoPages: INSPECTION_REPORT_MAX_PAGES + 1,
  });
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /20-page limit/,
  );
  expect(commands).toHaveLength(1);
});

test("surfaces pdfinfo failures", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const { sandbox } = createFakeSandbox(stagedFiles(), {
    pdfinfoExitCode: 1,
    pdfinfoStderr: "Syntax Error: Couldn't open file\n",
  });
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /pdfinfo failed/,
  );
});

test("rejects a missing staged file", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const { sandbox } = createFakeSandbox(new Map());
  globalThis.fetch = (async () => {
    throw new Error("must not be called");
  }) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /not found/,
  );
});

test("rejects responses whose dataInfo.type is not pdf", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const { sandbox } = createFakeSandbox(stagedFiles());
  const payload = paddleSuccessPayload();
  ((payload.result as Record<string, unknown>).dataInfo as Record<string, unknown>).type = "image";
  globalThis.fetch = (async () => jsonResponse(payload)) as typeof fetch;

  await expect(drain(parseInspectionReport({ sandbox, stagedPath: STAGED_PATH }))).rejects.toThrow(
    /dataInfo\.type/,
  );
});

test("produces no partial report when the request is cancelled", async () => {
  process.env.PADDLE_OCR_BASE_URL = "http://127.0.0.1:8080";
  const files = stagedFiles();
  const { sandbox } = createFakeSandbox(files);
  const controller = new AbortController();
  globalThis.fetch = (async () => {
    controller.abort();
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  await expect(
    drain(
      parseInspectionReport({
        sandbox,
        stagedPath: STAGED_PATH,
        paddleOptions: { signal: controller.signal },
      }),
    ),
  ).rejects.toThrow(/cancelled/);

  const reportId = deriveReportId("pump-inspection.pdf", PDF_BYTES);
  expect(files.has(`inspection-reports/${reportId}/manifest.json`)).toBe(false);
});

test("slugifyFilename produces safe slugs", () => {
  expect(slugifyFilename("Pump_P204A Inspection Report.PDF")).toBe("pump-p204a-inspection-report");
  expect(slugifyFilename("///.pdf")).toBe("report");
  expect(slugifyFilename("x".repeat(100))).toHaveLength(40);
});

test("parsePdfInfoPages reads the Pages line", () => {
  expect(parsePdfInfoPages("Title: test\nPages:         12\nEncrypted: no\n")).toBe(12);
  expect(parsePdfInfoPages("Pages:1\n")).toBe(1);
  expect(parsePdfInfoPages("no page count here")).toBeNull();
  expect(parsePdfInfoPages("Pages: 0\n")).toBeNull();
});

test("validateStagedPdf enforces signature and size", () => {
  validateStagedPdf(PDF_BYTES, 20);
  expect(() => validateStagedPdf(new Uint8Array(), 20)).toThrow(/empty/);
  expect(() => validateStagedPdf(new TextEncoder().encode("hello world"), 20)).toThrow(
    /%PDF- signature/,
  );
  expect(() => validateStagedPdf(PDF_BYTES, 4)).toThrow(/limit/);
});

test("rewriteMarkdownImageReferences rewrites markdown and html references", () => {
  const rewrites = [{ originalKey: "imgs/img_001.jpg", path: "images/page-001-image-001.jpg" }];
  const rewritten = rewriteMarkdownImageReferences(
    "![a](imgs/img_001.jpg)\n<img src=\"imgs/img_001.jpg\">",
    rewrites,
  );
  expect(rewritten).toBe("![a](images/page-001-image-001.jpg)\n<img src=\"images/page-001-image-001.jpg\">");
});

test("assembleInspectionReport names images per page and maps media types", () => {
  const assembled = assembleInspectionReport({
    reportId: "report-1",
    sourceFilename: "report.pdf",
    sourceSha256: "abc123",
    sourceBytes: PDF_BYTES,
    paddle: {
      logId: "log-2",
      dataType: "pdf",
      numPages: 2,
      pages: [
        {
          pageNumber: 1,
          markdownText: "![photo](imgs/a.jpg) ![chart](imgs/b.png)",
          images: [
            { key: "imgs/a.jpg", bytes: new Uint8Array([1]) },
            { key: "imgs/b.png", bytes: new Uint8Array([2]) },
            { key: "imgs/unknown", bytes: new Uint8Array([3]) },
          ],
          prunedResult: { page_number: 1 },
        },
        {
          pageNumber: 2,
          markdownText: "![retry](imgs/a.jpg)",
          images: [{ key: "imgs/a.jpg", bytes: new Uint8Array([1]) }],
          prunedResult: { page_number: 2 },
        },
      ],
    },
    requestedAt: "2026-09-06T00:00:00.000Z",
    durationMs: 42,
  });

  expect(assembled.imageFiles.map((image) => image.path)).toEqual([
    "images/page-001-image-001.jpg",
    "images/page-001-image-002.png",
    "images/page-001-image-003.jpg",
    "images/page-002-image-001.jpg",
  ]);
  expect(assembled.manifest.images[1]).toMatchObject({
    mediaType: "image/png",
    sourcePage: 1,
    originalKey: "imgs/b.png",
  });
  expect(assembled.manifest.images[0]?.label).toBe("photo");
  expect(assembled.manifest.images[1]?.label).toBe("chart");
  expect(assembled.manifest.images[2]?.label).toBeNull();
  expect(assembled.manifest.images[3]?.label).toBe("retry");
  expect(assembled.manifest.ocr).toEqual({
    status: "complete",
    logId: "log-2",
    requestedAt: "2026-09-06T00:00:00.000Z",
    durationMs: 42,
  });
  expect(assembled.reportMarkdown).toContain("<!-- page 1 -->");
  expect(assembled.reportMarkdown).toContain("![chart](images/page-001-image-002.png)");
  expect(assembled.layoutJson).toContain('"page": 1');
});
