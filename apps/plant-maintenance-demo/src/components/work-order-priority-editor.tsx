"use client";

import { useEffect, useState } from "react";

import { PRIORITIES, type WorkOrderPriority } from "@/data/seed";
import { updateWorkOrderPriority } from "@/lib/maintenance-store";
import { buttonPrimary, controlClasses } from "@/lib/ui";

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export function WorkOrderPriorityEditor({
  workOrderId,
  priority,
}: {
  readonly workOrderId: string;
  readonly priority: WorkOrderPriority;
}) {
  const [selectedPriority, setSelectedPriority] = useState<WorkOrderPriority>(priority);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  useEffect(() => {
    setSelectedPriority(priority);
  }, [priority]);

  function savePriority(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = updateWorkOrderPriority(workOrderId, selectedPriority);
    if (!result.ok) {
      setSaveState({
        kind: "error",
        message: "The priority was not saved. Check browser storage and try again.",
      });
      return;
    }

    setSaveState({
      kind: "saved",
      message: `Priority updated from ${result.previousPriority} to ${result.workOrder.priority}.`,
    });
  }

  function selectPriority(value: string) {
    const nextPriority = PRIORITIES.find((candidate) => candidate === value);
    if (nextPriority !== undefined) setSelectedPriority(nextPriority);
    setSaveState({ kind: "idle" });
  }

  return (
    <form
      onSubmit={savePriority}
      className="mt-5 rounded-lg border border-line bg-surface p-4"
      data-slot="work-order-priority-editor"
    >
      <label htmlFor="work-order-priority" className="mb-1.5 block text-xs font-semibold text-ink">
        Change priority
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          id="work-order-priority"
          name="priority"
          value={selectedPriority}
          onChange={(event) => selectPriority(event.target.value)}
          className={`${controlClasses} sm:max-w-56`}
        >
          {PRIORITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonPrimary}>
          Save priority
        </button>
      </div>
      {saveState.kind === "saved" ? (
        <p role="status" className="mt-3 text-sm font-medium text-positive">
          {saveState.message}
        </p>
      ) : saveState.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm font-medium text-critical">
          {saveState.message}
        </p>
      ) : null}
    </form>
  );
}
