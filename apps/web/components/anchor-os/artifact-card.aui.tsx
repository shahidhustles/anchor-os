"use client";

import { memo } from "react";
import { useEveSession } from "@assistant-ui/eve";
import {
  DownloadIcon,
  FileTextIcon,
  LoaderIcon,
  PanelRightOpenIcon,
  TableIcon,
  XCircleIcon,
} from "lucide-react";
import type { AssistantState, ToolCallMessagePartProps } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import {
  artifactBasename,
  extractArtifactPaths,
  formatArtifactSize,
  isArtifactToolName,
  type ArtifactEntry,
} from "@/lib/artifact-utils";
import { useArtifacts } from "./artifacts-context";

type CardState = "creating" | "editing" | "processing" | "ready" | "failed";

type ArtifactCardProps = ToolCallMessagePartProps;

/**
 * The workspace path is the artifact's identity, so each path renders exactly
 * one card: at the latest tool call in the thread that mentions it. Earlier
 * mentions render nothing instead of duplicating the card.
 */
const selectLatestArtifactCalls = (state: AssistantState): Map<string, string> => {
  const latest = new Map<string, string>();
  for (const message of state.thread.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-call" || !isArtifactToolName(part.toolName)) continue;
      for (const path of extractArtifactPaths(part.argsText)) {
        latest.set(path, part.toolCallId);
      }
    }
  }
  return latest;
};

const STATE_LABELS: Record<CardState, string> = {
  creating: "Creating",
  editing: "Editing",
  processing: "Finishing",
  ready: "Ready",
  failed: "Failed",
};

function ArtifactCardForPath({
  path,
  argsStatus,
  isError,
}: {
  readonly path: string;
  readonly argsStatus: ToolCallMessagePartProps["status"];
  readonly isError: boolean | undefined;
}) {
  const { getEntry, open } = useArtifacts();
  const session = useEveSession();
  const entry = getEntry(path);

  const state = deriveState(argsStatus, isError, entry);
  const clickable = state === "ready";

  return (
    <div
      data-slot="anchor-artifact-card"
      data-state={state}
      className={cn(
        "border-border bg-card flex w-full max-w-md items-center gap-3 rounded-lg border px-3 py-2.5",
      )}
    >
      <KindIcon kind={entry?.kind} state={state} />
      <button
        type="button"
        onClick={() => {
          if (clickable) open(path);
        }}
        disabled={!clickable}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 text-left",
          clickable ? "cursor-pointer" : "cursor-default",
        )}
        aria-label={clickable ? `Open ${artifactBasename(path)}` : artifactBasename(path)}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{artifactBasename(path)}</span>
          <StateLine state={state} entry={entry} />
        </span>
        {clickable && <PanelRightOpenIcon className="text-muted-foreground size-4 shrink-0" />}
      </button>
      {clickable && entry !== undefined && session?.sessionId !== undefined && (
        <a
          href={artifactDownloadUrl(session.sessionId, entry)}
          download={artifactBasename(path)}
          aria-label={`Download ${artifactBasename(path)}`}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md p-1.5 transition-colors"
        >
          <DownloadIcon className="size-4" />
        </a>
      )}
    </div>
  );
}

function artifactDownloadUrl(sessionId: string, entry: ArtifactEntry): string {
  const params = new URLSearchParams({
    sessionId,
    path: entry.path,
    version: String(entry.version),
  });
  return `/api/artifacts/file?${params.toString()}`;
}

function deriveState(
  status: ToolCallMessagePartProps["status"],
  isError: boolean | undefined,
  entry: ArtifactEntry | undefined,
): CardState {
  if (isError || status?.type === "incomplete") return "failed";
  if (status === undefined || status.type === "running" || status.type === "requires-action") {
    return entry === undefined ? "creating" : "editing";
  }
  return entry === undefined ? "processing" : "ready";
}

function KindIcon({
  kind,
  state,
}: {
  readonly kind: "docx" | "xlsx" | undefined;
  readonly state: CardState;
}) {
  if (state === "failed") {
    return <XCircleIcon className="text-destructive size-5 shrink-0" />;
  }
  if (state !== "ready") {
    return (
      <LoaderIcon className="text-muted-foreground size-4 shrink-0 animate-spin [animation-duration:1s]" />
    );
  }
  return kind === "xlsx" ? (
    <TableIcon className="text-muted-foreground size-5 shrink-0" />
  ) : (
    <FileTextIcon className="text-muted-foreground size-5 shrink-0" />
  );
}

function StateLine({
  state,
  entry,
}: {
  readonly state: CardState;
  readonly entry: ArtifactEntry | undefined;
}) {
  if (state === "failed") {
    return <span className="text-destructive text-xs">{STATE_LABELS.failed}</span>;
  }
  if (state !== "ready") {
    return (
      <span className="text-muted-foreground shimmer text-xs motion-reduce:animate-none">
        {STATE_LABELS[state]}
      </span>
    );
  }

  const details: string[] = [entry?.kind.toUpperCase() ?? "FILE"];
  if (entry?.wordCount !== undefined) details.push(`${entry.wordCount.toLocaleString()} words`);
  if (entry?.sheetNames !== undefined) {
    details.push(entry.sheetNames.length === 1 ? "1 sheet" : `${entry.sheetNames.length} sheets`);
  }
  if (entry?.sizeBytes !== undefined) details.push(formatArtifactSize(entry.sizeBytes));

  return <span className="text-muted-foreground text-xs">{details.join(" · ")}</span>;
}

const ArtifactCardImpl: React.FC<ArtifactCardProps> = ({
  toolCallId,
  argsText,
  status,
  isError,
}) => {
  const latestCallIds = useAuiState(selectLatestArtifactCalls);
  const paths = extractArtifactPaths(argsText ?? "").filter(
    (path) => latestCallIds.get(path) === toolCallId,
  );
  if (paths.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2 py-1">
      {paths.map((path) => (
        <ArtifactCardForPath key={path} path={path} argsStatus={status} isError={isError} />
      ))}
    </div>
  );
};

export const ArtifactCard = memo(ArtifactCardImpl);
