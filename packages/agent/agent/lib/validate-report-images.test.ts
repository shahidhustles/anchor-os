import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { validateReportImages } from "../skills/docx/scripts/validate_report_images.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createReportDir(files: Record<string, string | Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), "inspection-report-"));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(dir, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    reportId: "pump-inspection-abc12345",
    pageCount: 2,
    images: [
      {
        path: "images/page-001-image-001.jpg",
        mediaType: "image/jpeg",
        sourcePage: 1,
        originalKey: "imgs/a.jpg",
        label: "Pump P-204A drive-end bearing",
        boundingBox: null,
      },
      {
        path: "images/page-002-image-001.png",
        mediaType: "image/png",
        sourcePage: 2,
        originalKey: "imgs/b.png",
        label: "Piping layout diagram",
        boundingBox: null,
      },
    ],
  };
}

function jpegBytes(width: number, height: number): Uint8Array {
  const sof = Buffer.alloc(19);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]);
}

function pngBytes(width: number, height: number): Uint8Array {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8;
  ihdr[17] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

function webpBytes(): Uint8Array {
  return Buffer.from("RIFF\x24\x00\x00\x00WEBPVP8 ");
}

test("validates selected report images and reports their measured size and source page", async () => {
  const dir = createReportDir({
    "manifest.json": JSON.stringify(manifest()),
    "images/page-001-image-001.jpg": jpegBytes(640, 480),
    "images/page-002-image-001.png": pngBytes(320, 200),
  });

  const result = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: [join(dir, "images/page-001-image-001.jpg"), "images/page-002-image-001.png"],
  });

  expect(result.errors).toEqual([]);
  expect(result.images).toHaveLength(2);
  expect(result.images[0]).toEqual({
    path: join(dir, "images/page-001-image-001.jpg"),
    type: "jpg",
    width: 640,
    height: 480,
    sourcePage: 1,
    label: "Pump P-204A drive-end bearing",
  });
  expect(result.images[1]).toMatchObject({ type: "png", width: 320, height: 200, sourcePage: 2 });
});

test("rejects paths outside the report directory and traversal", async () => {
  const dir = createReportDir({
    "manifest.json": JSON.stringify(manifest()),
    "images/page-001-image-001.jpg": jpegBytes(10, 10),
    "original.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  });
  const outside = createReportDir({ "other.jpg": jpegBytes(10, 10) });

  const result = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: ["../attachments/secret.pdf", join(outside, "other.jpg"), "original.pdf"],
  });

  expect(result.images).toEqual([]);
  expect(result.errors.map((error) => error.error)).toEqual([
    expect.stringMatching(/outside the report directory/),
    expect.stringMatching(/outside the report directory/),
    expect.stringMatching(/not listed in manifest\.json/),
  ]);
});

test("rejects symlinks, including a symlinked images directory", async () => {
  const dir = createReportDir({
    "manifest.json": JSON.stringify(manifest()),
    "images/page-001-image-001.jpg": jpegBytes(10, 10),
  });
  const elsewhere = createReportDir({ "page-001-image-001.jpg": jpegBytes(10, 10) });
  symlinkSync(join(dir, "images/page-001-image-001.jpg"), join(dir, "images/link.jpg"));

  const result = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: [join(dir, "images/link.jpg")],
  });

  expect(result.images).toEqual([]);
  expect(result.errors[0]?.error).toMatch(/symbolic link/);

  rmSync(join(dir, "images"), { recursive: true, force: true });
  symlinkSync(elsewhere, join(dir, "images"));

  const escaped = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: [join(dir, "images/page-001-image-001.jpg")],
  });

  expect(escaped.images).toEqual([]);
  expect(escaped.errors[0]?.error).toMatch(/resolves outside the report directory/);
});

test("rejects missing files and unsupported image types", async () => {
  const dir = createReportDir({
    "manifest.json": JSON.stringify(manifest()),
    "images/page-001-image-001.jpg": jpegBytes(10, 10),
    "images/page-002-image-001.png": webpBytes(),
  });

  const result = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: [join(dir, "images/missing.jpg"), "images/page-002-image-001.png"],
  });

  expect(result.images).toEqual([]);
  expect(result.errors[0]?.error).toMatch(/does not exist/);
  expect(result.errors[1]?.error).toMatch(/unsupported image type/);
});

test("a missing or malformed manifest fails clearly", async () => {
  const dir = createReportDir({});

  await expect(
    validateReportImages({ manifestPath: join(dir, "manifest.json"), requestedPaths: [] }),
  ).rejects.toThrow(/Could not read/);

  const broken = createReportDir({ "manifest.json": "{not json" });
  await expect(
    validateReportImages({ manifestPath: join(broken, "manifest.json"), requestedPaths: [] }),
  ).rejects.toThrow(/Could not read/);
});

test("zero requested images is a valid selection", async () => {
  const dir = createReportDir({ "manifest.json": JSON.stringify(manifest()) });

  const result = await validateReportImages({
    manifestPath: join(dir, "manifest.json"),
    requestedPaths: [],
  });

  expect(result.errors).toEqual([]);
  expect(result.images).toEqual([]);
});