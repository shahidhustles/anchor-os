"use client";

import { Button } from "@/components/ui/button";
import {
  disableBrowserControl,
  enableBrowserControl,
  fetchBrowserControlState,
  isBrowserControlOn,
} from "@/lib/browser-control-client";
import type { BrowserControlStatusView } from "@anchor-os/browser-control/types";
import { Loader2Icon, RotateCcwIcon } from "lucide-react";
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

  return (
    <div className="border-t border-zinc-200 px-4 py-3" data-slot="browser-control">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-700">Browser control</span>
        <ToggleAction
          ready={ready}
          pending={pending}
          status={view.status}
          readError={readError}
          onEnable={enable}
          onDisable={disable}
          onRetryRead={read}
        />
      </div>
      <ToggleStatus status={view.status} pending={pending} error={view.error} />
      {readError !== null ? (
        <p
          role="alert"
          className="mt-1 text-xs text-red-600"
          data-slot="browser-control-read-error"
        >
          Status unavailable: {readError}
        </p>
      ) : null}
    </div>
  );
}

type ToggleActionProps = {
  readonly ready: boolean;
  readonly pending: PendingAction | null;
  readonly status: BrowserControlStatusView["status"];
  readonly readError: string | null;
  readonly onEnable: () => void;
  readonly onDisable: () => void;
  readonly onRetryRead: () => void;
};

function ToggleAction({
  ready,
  pending,
  status,
  readError,
  onEnable,
  onDisable,
  onRetryRead,
}: ToggleActionProps) {
  if (pending !== null || status === "starting" || status === "stopping") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
        {status === "starting" || pending === "enable" ? "Starting" : "Stopping"}
      </span>
    );
  }
  if (status === "error") {
    return (
      <Button type="button" variant="outline" size="xs" onClick={onEnable}>
        <RotateCcwIcon className="size-3" />
        Retry
      </Button>
    );
  }
  if (readError !== null && !ready) {
    return (
      <Button type="button" variant="outline" size="xs" onClick={onRetryRead}>
        <RotateCcwIcon className="size-3" />
        Retry
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-pressed={ready}
      onClick={ready ? onDisable : onEnable}
      aria-label={ready ? "Turn browser control off" : "Turn browser control on"}
    >
      {ready ? "Turn off" : "Turn on"}
    </Button>
  );
}

type ToggleStatusProps = {
  readonly status: BrowserControlStatusView["status"];
  readonly pending: PendingAction | null;
  readonly error?: string;
};

function ToggleStatus({ status, pending, error }: ToggleStatusProps) {
  const label = describeStatus(status, pending, error);
  return (
    <p
      className={`mt-1 text-xs ${status === "error" ? "text-red-600" : "text-zinc-500"}`}
      data-slot={`browser-control-status-${status}`}
    >
      {label}
    </p>
  );
}

function describeStatus(
  status: BrowserControlStatusView["status"],
  pending: PendingAction | null,
  error?: string,
): string {
  if (pending === "enable" || status === "starting") {
    return "Starting the browser window…";
  }
  if (pending === "disable" || status === "stopping") {
    return "Stopping browser control…";
  }
  if (status === "error") {
    return error !== undefined && error !== "" ? error : "Browser control failed.";
  }
  if (status === "on") {
    return "On. Eve can drive the visible Chrome window.";
  }
  return "Off. Eve has no browser access.";
}
