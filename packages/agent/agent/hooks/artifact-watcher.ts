import { defineHook, type HookContext } from "eve/hooks";
import type { RuntimeSandboxSession } from "eve/sandbox";

import { hasFileChanged, parseScanOutput, type WorkspaceFileEntry } from "../lib/artifact-scan";
import {
  loadManifest,
  saveManifest,
  writeArtifactBlob,
  type StoredManifest,
  type StoredManifestEntry,
} from "../../artifact-store";

const SCAN_COMMAND =
  "find /workspace -type f \\( -name '*.docx' -o -name '*.xlsx' \\) -not -path '*/node_modules/*' -not -path '*/.*' -printf '%p\\t%s\\t%T@\\n' 2>/dev/null";

const INSPECT_SCRIPT_PATH = "/tmp/anchor_artifact_inspect.py";

const INSPECT_SCRIPT = [
  "import json, sys, zipfile",
  "path, kind = sys.argv[1], sys.argv[2]",
  'info = {"valid": False}',
  "try:",
  "    with zipfile.ZipFile(path) as archive:",
  "        if archive.testzip() is not None:",
  "            print(json.dumps(info))",
  "            raise SystemExit",
  '        if kind == "docx":',
  "            import re",
  '            xml = archive.read("word/document.xml").decode("utf-8", "ignore")',
  '            text = re.sub(r"<[^>]+>", " ", xml)',
  '            info["wordCount"] = len(text.split())',
  "        else:",
  "            from openpyxl import load_workbook",
  "            workbook = load_workbook(path, read_only=True, data_only=False)",
  '            info["sheetNames"] = list(workbook.sheetnames)',
  "            workbook.close()",
  "    with open(path, 'rb') as handle:",
  "        import hashlib",
  '        info["contentHash"] = hashlib.sha256(handle.read()).hexdigest()',
  '    info["valid"] = True',
  "except SystemExit:",
  "    raise",
  "except Exception as error:",
  '    info["error"] = str(error)',
  "print(json.dumps(info))",
].join("\n");

type InspectResult = {
  readonly wordCount?: number;
  readonly sheetNames?: string[];
  readonly contentHash?: string;
  readonly error?: string;
};

type ArtifactSandbox = RuntimeSandboxSession;

const inFlightBySession = new Map<string, Promise<void>>();

export default defineHook({
  events: {
    async "action.result"(event, ctx) {
      if (!isArtifactWritingResult(event.data.result)) return;
      await enqueueScan(ctx.session.id, () => ctx.getSandbox());
    },
  },
});

export function isArtifactWritingResult(result: {
  readonly kind: string;
  readonly toolName?: string;
}): boolean {
  return (
    result.kind === "tool-result" &&
    (result.toolName === "bash" || result.toolName === "write_file")
  );
}

function enqueueScan(sessionId: string, getSandbox: () => Promise<ArtifactSandbox>): Promise<void> {
  const previous = inFlightBySession.get(sessionId) ?? Promise.resolve();
  const next = previous
    .then(() => getSandbox())
    .then((sandbox) => scanSession(sessionId, sandbox))
    .catch((error) => {
      console.warn("[artifact-watcher] scan failed", sessionId, error);
    });
  inFlightBySession.set(
    sessionId,
    next.catch(() => undefined),
  );
  return next;
}

async function scanSession(sessionId: string, sandbox: ArtifactSandbox): Promise<void> {
  const scan = await sandbox.run({ command: SCAN_COMMAND });
  const entries = parseScanOutput(scan.stdout);

  const manifest: StoredManifest = await loadManifest(sessionId);
  let changed = false;

  for (const entry of entries) {
    const existing: StoredManifestEntry | undefined = manifest.artifacts[entry.path];
    if (!hasFileChanged(existing, entry)) continue;

    const inspection = await inspectFile(sandbox, entry);
    if (inspection === null) continue;

    if (
      existing !== undefined &&
      inspection.contentHash !== undefined &&
      inspection.contentHash === existing.contentHash
    ) {
      manifest.artifacts[entry.path] = { ...existing, mtime: entry.mtime };
      changed = true;
      continue;
    }

    const bytes = await sandbox.readBinaryFile({ path: entry.absolutePath });
    if (bytes === null) continue;

    const version = (existing?.version ?? 0) + 1;
    await writeArtifactBlob(sessionId, entry.path, version, bytes);

    manifest.artifacts[entry.path] = {
      path: entry.path,
      kind: entry.kind,
      version,
      sizeBytes: entry.sizeBytes,
      wordCount: inspection.wordCount,
      sheetNames: inspection.sheetNames,
      updatedAt: new Date().toISOString(),
      contentHash: inspection.contentHash ?? `${entry.mtime}:${entry.sizeBytes}`,
      mtime: entry.mtime,
    };
    changed = true;
  }

  if (changed) {
    manifest.revision += 1;
    await saveManifest(sessionId, manifest);
  }
}

async function inspectFile(
  sandbox: ArtifactSandbox,
  entry: WorkspaceFileEntry,
): Promise<InspectResult | null> {
  await sandbox.run({
    command: `cat > ${INSPECT_SCRIPT_PATH} <<'ANCHOR_EOF'\n${INSPECT_SCRIPT}\nANCHOR_EOF`,
  });

  const quotedPath = `'${entry.absolutePath.replaceAll("'", `'\\''`)}'`;
  const result = await sandbox.run({
    command: `python3 ${INSPECT_SCRIPT_PATH} ${quotedPath} ${entry.kind}`,
  });

  try {
    const parsed: unknown = JSON.parse(result.stdout.trim());
    if (typeof parsed === "object" && parsed !== null) {
      const candidate = parsed as InspectResult & { valid?: boolean };
      if (candidate.valid === true) {
        return {
          wordCount: candidate.wordCount,
          sheetNames: candidate.sheetNames,
          contentHash: candidate.contentHash,
        };
      }
      if (candidate.error) {
        console.warn(`[artifact-watcher] invalid artifact ${entry.path}: ${candidate.error}`);
      }
    }
    return null;
  } catch {
    console.warn(`[artifact-watcher] unparseable inspection output for ${entry.path}`);
    return null;
  }
}
