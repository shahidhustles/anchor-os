"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useEveSession } from "@assistant-ui/eve";
import { FileTextIcon, LoaderIcon, TableIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { artifactBasename, formatArtifactSize, type ArtifactEntry } from "@/lib/artifact-utils";
import { sheetToStyledHtml } from "@/lib/sheet-html";
import { useArtifacts } from "./artifacts-context";

/** Chat on the left, artifact panel on the right; chat fills the width when closed. */
export function ArtifactWorkspace({ children }: { readonly children: ReactNode }) {
  const { openPath } = useArtifacts();

  return (
    <div className="flex h-full min-h-0">
      <section className={cn("min-w-0 flex-1", openPath !== null && "hidden md:block")}>
        {children}
      </section>
      <ArtifactPanel />
    </div>
  );
}

async function fetchArtifactBytes(
  sessionId: string,
  path: string,
  version: number,
): Promise<ArrayBuffer | null> {
  const params = new URLSearchParams({ sessionId, path, version: String(version) });
  const response = await fetch(`/api/artifacts/file?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.arrayBuffer();
}

export function ArtifactPanel() {
  const { openPath, close, getEntry } = useArtifacts();
  const session = useEveSession();
  const sessionId = session?.sessionId ?? null;
  const entry = openPath === null ? undefined : getEntry(openPath);

  if (openPath === null) return null;

  return (
    <aside
      data-slot="anchor-artifact-panel"
      className="border-border bg-background flex w-[min(46vw,44rem)] shrink-0 flex-col border-l"
      aria-label="Artifact preview"
    >
      <header className="border-border flex h-14 shrink-0 items-center gap-2 border-b px-3">
        {entry?.kind === "xlsx" ? (
          <TableIcon className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <FileTextIcon className="text-muted-foreground size-4 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{artifactBasename(openPath)}</span>
          <span className="text-muted-foreground truncate text-xs">
            {entry === undefined
              ? "Loading workspace data"
              : `v${entry.version} · ${formatArtifactSize(entry.sizeBytes)}`}
          </span>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close preview"
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground rounded-md p-1.5 transition-colors"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {entry === undefined || sessionId === null ? (
          <PanelPlaceholder label="The agent has not published this file yet." />
        ) : entry.kind === "docx" ? (
          <DocxView sessionId={sessionId} entry={entry} />
        ) : (
          <XlsxView sessionId={sessionId} entry={entry} />
        )}
      </div>
    </aside>
  );
}

function PanelPlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-sm">
      {label}
    </div>
  );
}

function useArtifactBytes(sessionId: string, entry: ArtifactEntry) {
  const [state, setState] = useState<{
    readonly status: "loading" | "ready" | "missing";
    readonly bytes: ArrayBuffer | null;
  }>({ status: "loading", bytes: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", bytes: null });
    void fetchArtifactBytes(sessionId, entry.path, entry.version).then((bytes) => {
      if (cancelled) return;
      setState(bytes === null ? { status: "missing", bytes: null } : { status: "ready", bytes });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, entry.path, entry.version]);

  return state;
}

function DocxView({
  sessionId,
  entry,
}: {
  readonly sessionId: string;
  readonly entry: ArtifactEntry;
}) {
  const { status, bytes } = useArtifactBytes(sessionId, entry);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (bytes === null || container === null) return;

    let cancelled = false;
    void (async () => {
      const { renderAsync } = await import("docx-preview");
      if (cancelled) return;
      container.innerHTML = "";
      await renderAsync(bytes, container, container, {
        className: "anchor-docx",
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: true,
        breakPages: true,
      });
    })().catch(() => {
      if (!cancelled) container.innerHTML = "";
    });

    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (status === "loading") return <PanelLoading />;
  if (status === "missing") return <PanelPlaceholder label="Preview data is unavailable." />;

  return <div ref={containerRef} className="anchor-docx-container bg-muted/30 min-h-full p-4" />;
}

function XlsxView({
  sessionId,
  entry,
}: {
  readonly sessionId: string;
  readonly entry: ArtifactEntry;
}) {
  const { status, bytes } = useArtifactBytes(sessionId, entry);
  const [activeSheet, setActiveSheet] = useState(0);
  const sheets = useSheetHtml(status === "ready" ? bytes : null, activeSheet);

  useEffect(() => {
    setActiveSheet(0);
  }, [entry.version]);

  if (status === "loading") return <PanelLoading />;
  if (status === "missing") return <PanelPlaceholder label="Preview data is unavailable." />;

  const sheetNames = entry.sheetNames ?? [];
  const sheetName = sheetNames[activeSheet] ?? sheetNames[0];

  return (
    <div className="flex h-full flex-col">
      {sheetNames.length > 1 && (
        <div className="border-border flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
          {sheetNames.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => setActiveSheet(index)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                index === activeSheet
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {sheets.html === null ? (
          <PanelLoading />
        ) : (
          <div
            className="anchor-xlsx-sheet"
            // The renderer emits a self-contained <table> with escaped cell text.
            dangerouslySetInnerHTML={{ __html: sheets.html }}
          />
        )}
      </div>
      {sheetName !== undefined && (
        <div className="text-muted-foreground shrink-0 px-3 py-1.5 text-xs">{sheetName}</div>
      )}
    </div>
  );
}

function useSheetHtml(bytes: ArrayBuffer | null, sheetIndex: number) {
  const [html, setHtml] = useState<string | null>(null);

  const build = useCallback(async (buffer: ArrayBuffer, index: number) => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { cellStyles: true });
    const name = workbook.SheetNames[index] ?? workbook.SheetNames[0];
    if (name === undefined) return null;
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) return null;
    return sheetToStyledHtml(sheet, XLSX);
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (bytes === null) {
      setHtml(null);
      return;
    }
    void build(bytes, sheetIndex).then((next) => {
      if (!cancelled) setHtml(next);
    });
    return () => {
      cancelled = true;
    };
  }, [bytes, sheetIndex, build]);

  return { html };
}

function PanelLoading() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center gap-2 p-6 text-sm">
      <LoaderIcon className="size-4 animate-spin" />
      Loading preview
    </div>
  );
}
