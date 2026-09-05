import type {
  ArtifactEntry,
  ArtifactKind,
  ArtifactManifestPayload,
} from "@anchor-os/agent/artifacts";

export type { ArtifactEntry, ArtifactKind, ArtifactManifestPayload };

const QUOTED_PATH_PATTERN = /["']([^"'\n]+\.(?:docx|xlsx))["']/gi;
const BARE_PATH_PATTERN = /([A-Za-z0-9_.\-/]+\.(?:docx|xlsx))/gi;

/**
 * Shell metacharacters, glob headers, and dependency directories never appear
 * in a real artifact path. Rejecting them keeps quoted compound commands like
 * `sh -c 'cd app && ls -lh *.docx'` from being read as a file name.
 */
const IMPOSSIBLE_IN_PATH = /&&|\|\||[;|<>`$]/;
const GLOB_LIKE_BASENAME = /^[*/?~]/;

/**
 * Only these tools can create or modify workspace artifacts. Restricting the
 * heuristic keeps other tool calls (questions, approvals, reads) rendering
 * through their normal UI even when their text mentions an office file.
 */
const ARTIFACT_TOOL_NAMES = new Set(["bash", "write_file"]);

export function isArtifactToolName(toolName: string): boolean {
  return ARTIFACT_TOOL_NAMES.has(toolName);
}

function isPlausibleArtifactPath(path: string): boolean {
  if (IMPOSSIBLE_IN_PATH.test(path)) return false;
  const basename = path.split("/").pop() ?? "";
  if (GLOB_LIKE_BASENAME.test(basename)) return false;
  if (path.includes("node_modules/")) return false;
  return true;
}

/**
 * Pulls artifact file paths out of streamed tool-call text (bash commands,
 * write_file arguments). Quoted paths are matched first so names with
 * spaces survive, then bare tokens in the remainder.
 */
export function extractArtifactPaths(text: string): string[] {
  if (!text) return [];

  const found: string[] = [];
  let remainder = text;

  for (const match of text.matchAll(QUOTED_PATH_PATTERN)) {
    if (match[1]) found.push(match[1]);
    remainder = remainder.replace(match[0], " ");
  }
  for (const match of remainder.matchAll(BARE_PATH_PATTERN)) {
    if (match[1]) found.push(match[1]);
  }

  return normalizePaths(found);
}

/** The manifest keys artifacts by workspace-relative path; tool text may use any form. */
export function normalizeArtifactPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\/workspace\//, "")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

/**
 * Only these tools can create or modify workspace artifacts. Restricting the
 * heuristic keeps other tool calls (questions, approvals, reads) rendering
 * through their normal UI even when their text mentions an office file.
 */
export function isArtifactToolPart(part: {
  readonly type: string;
  readonly toolName?: string;
  readonly argsText?: string;
}): boolean {
  return (
    part.type === "tool-call" &&
    part.toolName !== undefined &&
    ARTIFACT_TOOL_NAMES.has(part.toolName) &&
    extractArtifactPaths(part.argsText ?? "").length > 0
  );
}

function normalizePaths(paths: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const path of paths) {
    const normalized = normalizeArtifactPath(path);
    if (normalized === "") continue;
    if (!isPlausibleArtifactPath(normalized)) continue;
    if (!unique.has(normalized)) unique.set(normalized, normalized);
  }
  return [...unique.values()];
}

export function artifactBasename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function formatArtifactSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
