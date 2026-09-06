#!/usr/bin/env node
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HEADER_BYTES = 64 * 1024;

export function parseReportManifest(text) {
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("manifest.json is not an object");
  }
  if (!Array.isArray(parsed.images)) {
    throw new Error("manifest.json has no images array");
  }
  return parsed;
}

export async function validateReportImages({ manifestPath, requestedPaths }) {
  const reportDir = resolve(dirname(manifestPath));
  let reportDirReal;
  let manifest;
  try {
    reportDirReal = await realpath(reportDir);
    manifest = parseReportManifest(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("manifest.json")) {
      throw error;
    }
    throw new Error(`Could not read ${manifestPath}: ${error.message}`);
  }

  const manifestByPath = new Map();
  for (const entry of manifest.images) {
    if (typeof entry?.path === "string") manifestByPath.set(entry.path, entry);
  }

  const images = [];
  const errors = [];
  for (const requested of requestedPaths) {
    const result = await validateOne({
      requested,
      reportDir,
      reportDirReal,
      manifestByPath,
    });
    if (result.error !== null) errors.push({ path: requested, error: result.error });
    else images.push(result.image);
  }

  return { reportDir, images, errors };
}

async function validateOne({ requested, reportDir, reportDirReal, manifestByPath }) {
  if (typeof requested !== "string" || requested.trim() === "") {
    return { error: "empty image path" };
  }

  const resolved = isAbsolute(requested) ? resolve(requested) : resolve(reportDir, requested);
  const relativeToReport = relative(reportDir, resolved);
  if (relativeToReport.startsWith(`..${sep}`) || relativeToReport === "..") {
    return { error: `is outside the report directory ${reportDir}` };
  }

  let info;
  try {
    info = await lstat(resolved);
  } catch (error) {
    if (error.code === "ENOENT") return { error: "file does not exist" };
    if (error.code === "ENOTDIR") return { error: "file does not exist" };
    return { error: `cannot stat: ${error.message}` };
  }
  if (info.isSymbolicLink()) {
    return { error: "is a symbolic link; report images must be regular files" };
  }
  if (!info.isFile()) {
    return { error: "is not a regular file" };
  }

  try {
    const fileReal = await realpath(resolved);
    if (fileReal !== reportDirReal && !fileReal.startsWith(`${reportDirReal}${sep}`)) {
      return { error: `resolves outside the report directory ${reportDir}` };
    }
  } catch (error) {
    return { error: `cannot resolve: ${error.message}` };
  }

  const relativePath = relative(reportDir, resolved).split(sep).join("/");
  const entry = manifestByPath.get(relativePath);
  if (entry === undefined) {
    return { error: `is not listed in manifest.json (expected ${relativePath})` };
  }

  let header;
  try {
    header = await readFile(resolved, { start: 0, end: HEADER_BYTES });
  } catch (error) {
    return { error: `cannot read: ${error.message}` };
  }

  const type = detectImageType(header);
  if (type === null) {
    return { error: "unsupported image type for DOCX (supported: jpg, png, gif, bmp)" };
  }
  const size = readImageSize(type, header);
  if (size === null) {
    return { error: `could not read ${type} dimensions from the file header` };
  }

  return {
    error: null,
    image: {
      path: resolved,
      type,
      width: size.width,
      height: size.height,
      sourcePage: typeof entry.sourcePage === "number" ? entry.sourcePage : null,
      label: typeof entry.label === "string" ? entry.label : null,
    },
  };
}

function detectImageType(buffer) {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("latin1", 0, 6) === "GIF87a" ||
      buffer.toString("latin1", 0, 6) === "GIF89a")
  ) {
    return "gif";
  }
  if (buffer.length >= 2 && buffer.toString("latin1", 0, 2) === "BM") {
    return "bmp";
  }
  return null;
}

function readImageSize(type, buffer) {
  if (type === "png") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (type === "gif") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (type === "bmp") {
    return {
      width: Math.abs(buffer.readInt32LE(18)),
      height: Math.abs(buffer.readInt32LE(22)),
    };
  }
  return readJpegSize(buffer);
}

function readJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

function usage() {
  process.stderr.write(
    [
      "Usage: node validate_report_images.mjs <manifest.json> <image-path> [image-path ...]",
      "",
      "Validates model-selected inspection-report images against the report manifest.",
      "Prints JSON with reportDir, images[], and errors[], and exits non-zero when",
      "any requested image is rejected (outside the report directory, symlink,",
      "missing file, unsupported type, or not listed in manifest.json).",
      "Relative image paths resolve against the report directory.",
    ].join("\n") + "\n",
  );
}

async function main(argv) {
  const [manifestPath, ...requestedPaths] = argv;
  if (manifestPath === undefined) {
    usage();
    process.exit(2);
  }
  try {
    const result = await validateReportImages({ manifestPath, requestedPaths });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.errors.length > 0 ? 1 : 0);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
    process.exit(1);
  }
}

const invokedAsScript =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main(process.argv.slice(2));
}