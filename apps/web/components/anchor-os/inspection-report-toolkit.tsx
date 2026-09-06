"use client";

import {
  defineToolkit,
  type ToolCallMessagePartProps,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileSearchIcon,
  Loader2Icon,
  RotateCwIcon,
} from "lucide-react";
import { useCallback } from "react";

import { inspectionReportToolView } from "@/lib/inspection-report-attachment";
import { cn } from "@/lib/utils";

type ParseInspectionReportArgs = {
  readonly path?: string;
};

function InspectionReportCard({
  result,
  status,
}: ToolCallMessagePartProps<ParseInspectionReportArgs, unknown>) {
  const view = inspectionReportToolView(result, status);
  const isActive = view.tone === "active";
  const Icon =
    view.tone === "complete"
      ? CheckCircle2Icon
      : view.tone === "error"
        ? AlertCircleIcon
        : view.tone === "cancelled"
          ? FileSearchIcon
          : Loader2Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={isActive}
      data-slot="inspection-report-status"
      data-state={view.tone}
      className={cn(
        "my-2 flex w-full max-w-md items-center gap-3 rounded-xl border px-3.5 py-3 text-sm",
        view.tone === "error"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
          : "border-border/60 bg-muted/40 text-foreground",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0",
          isActive && "animate-spin motion-reduce:animate-none",
          view.tone === "complete" && "text-emerald-600 dark:text-emerald-400",
          view.tone === "cancelled" && "text-muted-foreground",
          view.tone === "error" && "text-red-600 dark:text-red-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{view.label}</p>
        {view.detail !== null && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{view.detail}</p>
        )}
      </div>
      {view.retryable && <RetryButton />}
    </div>
  );
}

function RetryButton() {
  const aui = useAui();
  const enabled = useAuiState((s) => !s.thread.isRunning && !s.thread.isDisabled);
  const onRetry = useCallback(() => {
    const messages = aui.thread.getState().messages;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role !== "user") continue;
      aui.thread.append({ role: "user", content: message.content });
      return;
    }
  }, [aui]);

  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={!enabled}
      data-slot="inspection-report-retry"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:pointer-events-none disabled:opacity-50 dark:border-red-950 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
    >
      <RotateCwIcon aria-hidden="true" className="size-3.5" />
      Retry
    </button>
  );
}

export const inspectionReportToolkit = defineToolkit({
  parse_inspection_report: {
    type: "backend",
    display: "standalone",
    render: InspectionReportCard,
  },
});

export default inspectionReportToolkit;
