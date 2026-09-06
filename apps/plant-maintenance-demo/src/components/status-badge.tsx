import type { WorkOrderPriority, WorkOrderStatus, OperatingStatus } from "@/data/seed";

export type BadgeTone = "ok" | "warn" | "critical" | "progress" | "neutral";

const TONE_CLASSES: Record<BadgeTone, string> = {
  ok: "border-ok-line bg-ok-bg text-ok",
  warn: "border-warn-line bg-warn-bg text-warn",
  critical: "border-critical-line bg-critical-bg text-critical",
  progress: "border-progress-line bg-progress-bg text-progress",
  neutral: "border-line bg-hold-bg text-hold",
};

export function StatusBadge({ label, tone }: { label: string; tone: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

export function operatingStatusTone(status: OperatingStatus): BadgeTone {
  if (status === "Running") return "ok";
  if (status === "Standby") return "warn";
  return "critical";
}

export function workOrderStatusTone(status: WorkOrderStatus): BadgeTone {
  if (status === "Open") return "ok";
  if (status === "In Progress") return "progress";
  return "neutral";
}

export function priorityTone(priority: WorkOrderPriority): BadgeTone {
  if (priority === "High") return "critical";
  if (priority === "Medium") return "warn";
  return "neutral";
}
