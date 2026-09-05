import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { ArtifactEntry, ArtifactManifestPayload } from "./artifacts";

export type StoredManifestEntry = ArtifactEntry & {
  readonly contentHash: string;
  readonly mtime: number;
};

export type StoredManifest = {
  readonly sessionId: string;
  readonly revision: number;
  readonly artifacts: Readonly<Record<string, StoredManifestEntry>>;
};

export function getArtifactCacheRoot(): string {
  return process.env.ANCHOR_ARTIFACT_CACHE ?? join(tmpdir(), "anchor-os-artifacts");
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function sessionDir(sessionId: string): string {
  return join(getArtifactCacheRoot(), safeSegment(sessionId));
}

function manifestPath(sessionId: string): string {
  return join(sessionDir(sessionId), "manifest.json");
}

export function artifactPathKey(path: string): string {
  return createHash("sha1").update(path).digest("hex");
}

export function blobPath(sessionId: string, path: string, version: number): string {
  return join(sessionDir(sessionId), "blobs", `${artifactPathKey(path)}.v${version}.bin`);
}

const EMPTY_MANIFEST = (sessionId: string): StoredManifest => ({
  sessionId,
  revision: 0,
  artifacts: {},
});

export async function loadManifest(sessionId: string): Promise<StoredManifest> {
  try {
    const raw = await readFile(manifestPath(sessionId), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isStoredManifest(parsed)) return parsed;
  } catch {
    // Missing or unreadable manifest behaves like an empty workspace.
  }
  return EMPTY_MANIFEST(sessionId);
}

export async function saveManifest(sessionId: string, manifest: StoredManifest): Promise<void> {
  const directory = sessionDir(sessionId);
  const target = manifestPath(sessionId);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.manifest-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporary, target);
}

export async function writeArtifactBlob(
  sessionId: string,
  path: string,
  version: number,
  bytes: Uint8Array,
): Promise<void> {
  const target = blobPath(sessionId, path, version);
  await mkdir(join(sessionDir(sessionId), "blobs"), { recursive: true });
  const temporary = `${target}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
}

export async function readArtifactBlob(
  sessionId: string,
  path: string,
  version: number,
): Promise<Uint8Array | null> {
  try {
    return await readFile(blobPath(sessionId, path, version));
  } catch {
    return null;
  }
}

/** Manifest payload for the API surface: entries sorted by update time, internals stripped. */
export function toManifestPayload(manifest: StoredManifest): ArtifactManifestPayload {
  const artifacts: ArtifactEntry[] = Object.values(manifest.artifacts)
    .map(({ contentHash: _contentHash, mtime: _mtime, ...entry }) => entry)
    .sort((a, b) => a.path.localeCompare(b.path));
  return { sessionId: manifest.sessionId, revision: manifest.revision, artifacts };
}

function isStoredManifest(value: unknown): value is StoredManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { sessionId?: unknown; revision?: unknown; artifacts?: unknown };
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.revision === "number" &&
    typeof candidate.artifacts === "object" &&
    candidate.artifacts !== null
  );
}
