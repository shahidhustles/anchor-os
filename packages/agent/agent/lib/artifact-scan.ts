import { isArtifactKind, type ArtifactKind } from "../../artifacts";

export type WorkspaceFileEntry = {
  /** Absolute sandbox path, e.g. "/workspace/Approval_Note.docx". */
  readonly absolutePath: string;
  /** Workspace-relative path, e.g. "Approval_Note.docx". */
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly sizeBytes: number;
  readonly mtime: number;
};

const WORKSPACE_ROOT = "/workspace";

/**
 * Parses `find -printf '%p\t%s\t%T@\n'` output for artifact files.
 * Skips malformed lines, files outside /workspace, and non-artifact paths.
 */
export function parseScanOutput(stdout: string): WorkspaceFileEntry[] {
  const entries: WorkspaceFileEntry[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const parts = trimmed.split("\t");
    if (parts.length !== 3) continue;

    const [absolutePath, sizeText, mtimeText] = parts;
    const sizeBytes = Number(sizeText);
    const mtime = Number(mtimeText);
    if (sizeText === undefined || mtimeText === undefined) continue;
    if (!Number.isFinite(sizeBytes) || !Number.isFinite(mtime)) continue;

    const kind = kindFromPath(absolutePath);
    if (kind === null) continue;

    entries.push({
      absolutePath,
      path: toWorkspacePath(absolutePath),
      kind,
      sizeBytes,
      mtime,
    });
  }
  return entries;
}

export function kindFromPath(path: string): ArtifactKind | null {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return isArtifactKind(extension) ? extension : null;
}

export function toWorkspacePath(absolutePath: string): string {
  if (absolutePath === WORKSPACE_ROOT) return "";
  if (absolutePath.startsWith(`${WORKSPACE_ROOT}/`)) return absolutePath.slice(WORKSPACE_ROOT.length + 1);
  return absolutePath.replace(/^\/+/, "");
}

export function hasFileChanged(
  previous: { readonly sizeBytes: number; readonly mtime: number } | undefined,
  current: { readonly sizeBytes: number; readonly mtime: number },
): boolean {
  return previous === undefined || previous.sizeBytes !== current.sizeBytes || previous.mtime !== current.mtime;
}
