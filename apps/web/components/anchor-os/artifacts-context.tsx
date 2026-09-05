"use client";

import { useAuiState } from "@assistant-ui/react";
import { useEveSession } from "@assistant-ui/eve";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { ArtifactEntry, ArtifactManifestPayload } from "@/lib/artifact-utils";

type ArtifactsContextValue = {
  readonly openPath: string | null;
  readonly getEntry: (path: string) => ArtifactEntry | undefined;
  readonly open: (path: string) => void;
  readonly close: () => void;
};

const ArtifactsContext = createContext<ArtifactsContextValue | null>(null);

const POLL_INTERVAL_MS = 1500;
const IDLE_REFRESH_MS = 1500;

function isManifestPayload(value: unknown): value is ArtifactManifestPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { sessionId?: unknown; revision?: unknown; artifacts?: unknown };
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.revision === "number" &&
    Array.isArray(candidate.artifacts)
  );
}

export function ArtifactsProvider({ children }: { readonly children: ReactNode }) {
  const session = useEveSession();
  const sessionId = session?.sessionId ?? null;
  const isRunning = useAuiState((state) => state.thread.isRunning);

  const [payload, setPayload] = useState<ArtifactManifestPayload | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/artifacts?sessionId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (isManifestPayload(data)) setPayload(data);
    } catch {
      // Transient network errors are fine; the next poll retries.
    }
  }, []);

  useEffect(() => {
    if (sessionId === null) {
      setPayload(null);
      setOpenPath(null);
      return;
    }

    void refresh(sessionId);

    if (isRunning || openPath !== null) {
      const timer = setInterval(() => void refresh(sessionId), POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }

    const delayed = setTimeout(() => void refresh(sessionId), IDLE_REFRESH_MS);
    return () => clearTimeout(delayed);
  }, [sessionId, isRunning, openPath, refresh]);

  const entries = useMemo(() => {
    const map = new Map<string, ArtifactEntry>();
    for (const entry of payload?.artifacts ?? []) map.set(entry.path, entry);
    return map;
  }, [payload]);

  const value = useMemo<ArtifactsContextValue>(
    () => ({
      openPath,
      getEntry: (path) => entries.get(path),
      open: setOpenPath,
      close: () => setOpenPath(null),
    }),
    [entries, openPath],
  );

  return <ArtifactsContext.Provider value={value}>{children}</ArtifactsContext.Provider>;
}

export function useArtifacts(): ArtifactsContextValue {
  const value = useContext(ArtifactsContext);
  if (value === null) throw new Error("useArtifacts must be used inside ArtifactsProvider");
  return value;
}
