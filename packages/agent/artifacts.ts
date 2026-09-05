export const ARTIFACT_EXTENSIONS = ["docx", "xlsx"] as const;

export type ArtifactKind = (typeof ARTIFACT_EXTENSIONS)[number];

export type ArtifactEntry = {
  /** Workspace-relative path, e.g. "Approval_Note.docx". */
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly version: number;
  readonly sizeBytes: number;
  readonly wordCount?: number | undefined;
  readonly sheetNames?: readonly string[] | undefined;
  readonly updatedAt: string;
};

export type ArtifactManifestPayload = {
  readonly sessionId: string;
  readonly revision: number;
  readonly artifacts: readonly ArtifactEntry[];
};

export function isArtifactKind(value: string): value is ArtifactKind {
  return (ARTIFACT_EXTENSIONS as readonly string[]).includes(value);
}

export const ARTIFACT_MEDIA_TYPES: Record<ArtifactKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
