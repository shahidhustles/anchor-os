"use client";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  disableBrowserControl,
  enableBrowserControl,
  fetchBrowserControlState,
  isBrowserControlOn,
} from "@/lib/browser-control-client";
import type { BrowserControlStatusView } from "@anchor-os/browser-control/types";
import { useCallback, useEffect, useState } from "react";

type BrowserControlToggleProps = {
  readonly onReadyChange: (ready: boolean) => void;
};

type PendingAction = "enable" | "disable";

const OFF_VIEW: BrowserControlStatusView = { status: "off" };

export function BrowserControlToggle({ onReadyChange }: BrowserControlToggleProps) {
  const [view, setView] = useState<BrowserControlStatusView>(OFF_VIEW);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const ready = pending === "disable" ? false : isBrowserControlOn(view);

  useEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);

  const read = useCallback(() => {
    setReadError(null);
    void fetchBrowserControlState()
      .then(setView)
      .catch((error: unknown) => {
        setReadError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  useEffect(read, [read]);

  const enable = useCallback(() => {
    setPending("enable");
    void enableBrowserControl()
      .then(setView)
      .catch((error: unknown) => {
        setView({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setPending(null));
  }, []);

  const disable = useCallback(() => {
    setPending("disable");
    void disableBrowserControl()
      .then(setView)
      .catch((error: unknown) => {
        setView({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => setPending(null));
  }, []);

  const busy = pending !== null || view.status === "starting" || view.status === "stopping";
  const tooltip = describeControl({
    ready,
    pending,
    status: view.status,
    error: view.error ?? readError ?? undefined,
  });

  return (
    <div
      className="flex items-center justify-between gap-3 border-t border-border px-4 py-3"
      data-slot="browser-control"
    >
      <span className="text-xs font-medium text-foreground">Browser control</span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Switch
              id="browser-control-switch"
              checked={ready}
              disabled={busy}
              aria-label={ready ? "Turn browser control off" : "Turn browser control on"}
              aria-invalid={view.status === "error" || readError !== null || undefined}
              onCheckedChange={(checked) => {
                if (checked) enable();
                else disable();
              }}
            />
          }
        />
        <TooltipContent side="right">{tooltip}</TooltipContent>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {tooltip}
      </span>
    </div>
  );
}

type ControlDescriptionInput = {
  readonly ready: boolean;
  readonly pending: PendingAction | null;
  readonly status: BrowserControlStatusView["status"];
  readonly error?: string;
};

function describeControl({ ready, pending, status, error }: ControlDescriptionInput): string {
  if (pending === "enable" || status === "starting") {
    return "Starting browser control";
  }
  if (pending === "disable" || status === "stopping") {
    return "Stopping browser control";
  }
  if (error !== undefined && error !== "") {
    return `${error} Toggle to retry.`;
  }
  return ready ? "Turn off browser control" : "Turn on browser control";
}
