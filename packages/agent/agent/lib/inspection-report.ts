import { createHash } from "node:crypto";
import { basename } from "node:path";

import type { SandboxSession } from "eve/sandbox";

import type { PaddleOcrOptions, PaddleOcrResult } from "./paddle-ocr";
import { parsePaddleOcrPdf, PADDLE_OCR_DEFAULT_MAX_INPUT_BYTES } from "./paddle-ocr";

export const INSPECTION_REPORT_SCHEMA_VERSION = 1;
export const INSPECTION_REPORT_MAX_PAGES = 20;
export const INSPECTION_REPORT_ROOT = "inspection-reports";

export class InspectionReportCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionReportCancelledError";
  }
}

export class InspectionReportRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionReportRetryableError";
  }
}

export type InspectionReportFailure = {
  readonly status: "failed";
  readonly retryable: boolean;
  readonly error: string;
};

export type InspectionReportSandbox = Pick<
  SandboxSession,
  | "run"
  | "readBinaryFile"
  | "readTextFile"
  | "writeBinaryFile"
  | "writeTextFile"
  | "removePath"
  | "resolvePath"
>;

export type InspectionReportProgress =
  | { readonly phase: "validating"; readonly filename: string; readonly sizeBytes: number }
  | { readonly phase: "reading"; readonly totalPages: number }
  | { readonly phase: "saving"; readonly totalPages: number; readonly imageCount: number };

export type InspectionReportImageEntry = {
  readonly path: string;
  readonly mediaType: string;
  readonly sourcePage: number;
  readonly originalKey: string;
  readonly label: string | null;
  readonly boundingBox: readonly number[] | null;
};

export type InspectionReportManifest = {
  readonly schemaVersion: number;
  readonly reportId: string;
  readonly source: {
    readonly filename: string;
    readonly sha256: string;
    readonly sizeBytes: number;
  };
  readonly ocr: {
    readonly status: "complete";
    readonly logId: string;
    readonly requestedAt: string;
    readonly durationMs: number;
  };
  readonly pageCount: number;
  readonly paddleResultCount: number;
  readonly files: {
    readonly original: string;
    readonly report: string;
    readonly layout: string;
    readonly images: string;
  };
  readonly images: readonly InspectionReportImageEntry[];
};

export type InspectionReportResult = {
  readonly status: "complete";
  readonly reportId: string;
  readonly reportDir: string;
  readonly originalPath: string;
  readonly reportPath: string;
  readonly layoutPath: string;
  readonly manifestPath: string;
  readonly imagePaths: readonly string[];
  readonly totalPages: number;
  readonly imageCount: number;
  readonly logId: string;
  readonly cached: boolean;
};

export type AssembledReport = {
  readonly reportId: string;
  readonly reportMarkdown: string;
  readonly layoutJson: string;
  readonly manifest: InspectionReportManifest;
  readonly imageFiles: readonly { readonly path: string; readonly bytes: Uint8Array }[];
};

export function slugifyFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").toLowerCase();
  const slug = stem
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "report";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function deriveReportId(filename: string, pdfBytes: Uint8Array): string {
  return `${slugifyFilename(filename)}-${sha256Hex(pdfBytes).slice(0, 8)}`;
}

export function validateStagedPdf(
  pdf: Uint8Array,
  maxBytes: number = PADDLE_OCR_DEFAULT_MAX_INPUT_BYTES,
): void {
  if (pdf.byteLength === 0) {
    throw new Error("The staged inspection report is empty.");
  }
  if (!hasPdfSignature(pdf)) {
    throw new Error("The staged file is not a PDF (missing %PDF- signature).");
  }
  if (pdf.byteLength > maxBytes) {
    throw new Error(
      `The staged PDF is ${mib(pdf.byteLength).toFixed(2)} MiB, above the ${mib(maxBytes).toFixed(2)} MiB limit.`,
    );
  }
}

export function parsePdfInfoPages(stdout: string): number | null {
  const match = stdout.match(/^Pages:\s*(\d+)\s*$/m);
  if (match === null) return null;
  const pages = Number(match[1]);
  return Number.isSafeInteger(pages) && pages > 0 ? pages : null;
}

export function assembleInspectionReport(input: {
  readonly reportId: string;
  readonly sourceFilename: string;
  readonly sourceSha256: string;
  readonly sourceBytes: Uint8Array;
  readonly paddle: PaddleOcrResult;
  readonly requestedAt: string;
  readonly durationMs: number;
}): AssembledReport {
  const imageFiles: { path: string; bytes: Uint8Array }[] = [];
  const imageEntries: InspectionReportImageEntry[] = [];
  const markdownPages: string[] = [];
  const layoutPages: { page: number; result: Record<string, unknown> }[] = [];

  for (const page of input.paddle.pages) {
    const rewrites = page.images.map((image, imageIndex) => {
      const { extension, mediaType } = imageExtensionAndMediaType(image.key);
      const path = `images/page-${pad3(page.pageNumber)}-image-${pad3(imageIndex + 1)}.${extension}`;
      imageFiles.push({ path, bytes: image.bytes });
      imageEntries.push({
        path,
        mediaType,
        sourcePage: page.pageNumber,
        originalKey: image.key,
        label: imageLabel(page.markdownText, image.key),
        boundingBox: null,
      });
      return { originalKey: image.key, path };
    });

    markdownPages.push(
      `<!-- page ${page.pageNumber} -->\n\n${rewriteMarkdownImageReferences(page.markdownText, rewrites).trim()}`,
    );
    layoutPages.push({ page: page.pageNumber, result: page.prunedResult });
  }

  const manifest: InspectionReportManifest = {
    schemaVersion: INSPECTION_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    source: {
      filename: input.sourceFilename,
      sha256: input.sourceSha256,
      sizeBytes: input.sourceBytes.byteLength,
    },
    ocr: {
      status: "complete",
      logId: input.paddle.logId,
      requestedAt: input.requestedAt,
      durationMs: input.durationMs,
    },
    pageCount: input.paddle.numPages,
    paddleResultCount: input.paddle.pages.length,
    files: { original: "original.pdf", report: "report.md", layout: "layout.json", images: "images/" },
    images: imageEntries,
  };

  return {
    reportId: input.reportId,
    reportMarkdown: `${markdownPages.join("\n\n")}\n`,
    layoutJson: `${JSON.stringify(
      { schemaVersion: INSPECTION_REPORT_SCHEMA_VERSION, reportId: input.reportId, pages: layoutPages },
      null,
      2,
    )}\n`,
    manifest,
    imageFiles,
  };
}

export function rewriteMarkdownImageReferences(
  markdownText: string,
  rewrites: readonly { readonly originalKey: string; readonly path: string }[],
): string {
  let text = markdownText;
  for (const { originalKey, path } of rewrites) {
    text = text.split(`](${originalKey})`).join(`](${path})`);
    text = text.split(`src="${originalKey}"`).join(`src="${path}"`);
  }
  return text;
}

export function imageLabel(markdownText: string, originalKey: string): string | null {
  const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(originalKey)}\\)`);
  const label = markdownText.match(pattern)?.[1]?.trim();
  return label !== undefined && label !== "" ? label : null;
}

export async function* parseInspectionReport(input: {
  readonly sandbox: InspectionReportSandbox;
  readonly stagedPath: string;
  readonly maxInputBytes?: number;
  readonly paddleOptions?: PaddleOcrOptions;
}): AsyncGenerator<InspectionReportProgress | InspectionReportResult, void, void> {
  const { sandbox, stagedPath } = input;
  const signal = input.paddleOptions?.signal;
  const filename = basename(stagedPath);

  const bytes = await sandbox.readBinaryFile({ path: stagedPath, abortSignal: signal });
  if (bytes === null) {
    throw new Error(`Staged inspection report not found at ${stagedPath}.`);
  }

  yield { phase: "validating", filename, sizeBytes: bytes.byteLength };
  validateStagedPdf(bytes, input.maxInputBytes);

  const sha256 = sha256Hex(bytes);
  const reportId = deriveReportId(filename, bytes);
  const reportDir = `${INSPECTION_REPORT_ROOT}/${reportId}`;

  const existingManifest = await readExistingManifest(sandbox, `${reportDir}/manifest.json`, signal);
  if (existingManifest !== null) {
    if (existingManifest.source.sha256 !== sha256) {
      throw new Error(
        `A different report already occupies ${reportDir}; refusing to overwrite it with different source bytes.`,
      );
    }
    yield buildResult({ reportId, sandbox, manifest: existingManifest, cached: true });
    return;
  }

  await sandbox.removePath({ path: reportDir, force: true, recursive: true, abortSignal: signal });

  const pdfInfo = await sandbox.run({
    command: `pdfinfo ${shellQuote(sandbox.resolvePath(stagedPath))}`,
    abortSignal: signal,
  });
  if (pdfInfo.exitCode !== 0) {
    throw new Error(
      `pdfinfo failed for the staged PDF: ${firstLine(pdfInfo.stderr) || `exit code ${pdfInfo.exitCode}`}`,
    );
  }
  const localPages = parsePdfInfoPages(pdfInfo.stdout);
  if (localPages === null) {
    throw new Error("pdfinfo output did not include a page count.");
  }
  if (localPages > INSPECTION_REPORT_MAX_PAGES) {
    throw new Error(
      `The staged PDF has ${localPages} pages, above the ${INSPECTION_REPORT_MAX_PAGES}-page limit.`,
    );
  }

  yield { phase: "reading", totalPages: localPages };

  const requestedAt = new Date().toISOString();
  const startedAt = Date.now();
  let paddle: PaddleOcrResult;
  try {
    paddle = await parsePaddleOcrPdf(bytes, input.paddleOptions);
  } catch (error) {
    if (signal?.aborted) {
      throw new InspectionReportCancelledError(
        error instanceof Error ? error.message : "Paddle OCR request was cancelled.",
      );
    }
    throw new InspectionReportRetryableError(error instanceof Error ? error.message : String(error));
  }
  const durationMs = Date.now() - startedAt;

  if (signal?.aborted) {
    throw new InspectionReportCancelledError(
      "Paddle OCR request was cancelled after completion; ignoring the response.",
    );
  }
  if (paddle.dataType !== "pdf") {
    throw new InspectionReportRetryableError(
      `Paddle OCR returned dataInfo.type "${paddle.dataType}" instead of "pdf" (logId ${paddle.logId}).`,
    );
  }
  if (paddle.numPages !== localPages) {
    throw new InspectionReportRetryableError(
      `Paddle OCR page count ${paddle.numPages} disagrees with the locally counted ${localPages} pages (logId ${paddle.logId}).`,
    );
  }

  const assembled = assembleInspectionReport({
    reportId,
    sourceFilename: filename,
    sourceSha256: sha256,
    sourceBytes: bytes,
    paddle,
    requestedAt,
    durationMs,
  });

  yield { phase: "saving", totalPages: paddle.numPages, imageCount: assembled.imageFiles.length };

  const stagingDir = `${INSPECTION_REPORT_ROOT}/.staging-${reportId}`;
  await sandbox.removePath({ path: stagingDir, force: true, recursive: true, abortSignal: signal });
  try {
    await sandbox.writeBinaryFile({
      path: `${stagingDir}/original.pdf`,
      content: bytes,
      abortSignal: signal,
    });
    await sandbox.writeTextFile({
      path: `${stagingDir}/report.md`,
      content: assembled.reportMarkdown,
      abortSignal: signal,
    });
    await sandbox.writeTextFile({
      path: `${stagingDir}/layout.json`,
      content: assembled.layoutJson,
      abortSignal: signal,
    });
    for (const imageFile of assembled.imageFiles) {
      await sandbox.writeBinaryFile({
        path: `${stagingDir}/${imageFile.path}`,
        content: imageFile.bytes,
        abortSignal: signal,
      });
    }
    await sandbox.writeTextFile({
      path: `${stagingDir}/manifest.json`,
      content: `${JSON.stringify(assembled.manifest, null, 2)}\n`,
      abortSignal: signal,
    });

    const publish = await sandbox.run({
      command: `mv ${shellQuote(sandbox.resolvePath(stagingDir))} ${shellQuote(sandbox.resolvePath(reportDir))}`,
      abortSignal: signal,
    });
    if (publish.exitCode !== 0) {
      throw new InspectionReportRetryableError(
        `Publishing the inspection report failed: ${firstLine(publish.stderr) || `exit code ${publish.exitCode}`}`,
      );
    }
  } catch (error) {
    await sandbox
      .removePath({ path: stagingDir, force: true, recursive: true })
      .catch(() => undefined);
    throw error;
  }

  yield buildResult({ reportId, sandbox, manifest: assembled.manifest, cached: false });
}

async function readExistingManifest(
  sandbox: InspectionReportSandbox,
  path: string,
  signal: AbortSignal | undefined,
): Promise<InspectionReportManifest | null> {
  const text = await sandbox.readTextFile({ path, abortSignal: signal });
  if (text === null) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      typeof parsed.reportId !== "string" ||
      typeof parsed.pageCount !== "number" ||
      !Array.isArray(parsed.images)
    ) {
      return null;
    }
    const { source, ocr } = parsed;
    if (!isRecord(source) || typeof source.sha256 !== "string") return null;
    if (!isRecord(ocr) || typeof ocr.logId !== "string") return null;
    return parsed as InspectionReportManifest;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildResult(input: {
  readonly reportId: string;
  readonly sandbox: InspectionReportSandbox;
  readonly manifest: InspectionReportManifest;
  readonly cached: boolean;
}): InspectionReportResult {
  const absolute = (relative: string) => input.sandbox.resolvePath(relative);
  const reportDir = `${INSPECTION_REPORT_ROOT}/${input.reportId}`;
  return {
    status: "complete",
    reportId: input.reportId,
    reportDir: absolute(reportDir),
    originalPath: absolute(`${reportDir}/original.pdf`),
    reportPath: absolute(`${reportDir}/report.md`),
    layoutPath: absolute(`${reportDir}/layout.json`),
    manifestPath: absolute(`${reportDir}/manifest.json`),
    imagePaths: input.manifest.images.map((image) => absolute(`${reportDir}/${image.path}`)),
    totalPages: input.manifest.pageCount,
    imageCount: input.manifest.images.length,
    logId: input.manifest.ocr.logId,
    cached: input.cached,
  };
}

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

function imageExtensionAndMediaType(key: string): { extension: string; mediaType: string } {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const mediaType = IMAGE_MEDIA_TYPES[extension];
  return mediaType === undefined
    ? { extension: "jpg", mediaType: "image/jpeg" }
    : { extension, mediaType };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function hasPdfSignature(pdf: Uint8Array): boolean {
  return (
    pdf.byteLength >= 5 &&
    pdf[0] === 0x25 &&
    pdf[1] === 0x50 &&
    pdf[2] === 0x44 &&
    pdf[3] === 0x46 &&
    pdf[4] === 0x2d
  );
}

function shellQuote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

function mib(bytes: number): number {
  return bytes / (1024 * 1024);
}
