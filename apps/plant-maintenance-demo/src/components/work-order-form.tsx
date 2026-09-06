"use client";

import { useState } from "react";

import {
  PRIORITIES,
  TEAMS,
  WORK_ORDER_STATUSES,
  type Asset,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from "@/data/seed";
import {
  createWorkOrder,
  validateWorkOrderInput,
  type WorkOrderFieldErrors,
  type WorkOrderFormValues,
} from "@/lib/maintenance-store";
import { buttonPrimary, buttonSecondary, controlClasses } from "@/lib/ui";

const EMPTY_VALUES: WorkOrderFormValues = {
  assetId: "",
  title: "",
  description: "",
  priority: "",
  assignedTeam: "",
  status: "",
};

const FIELD_ORDER: (keyof WorkOrderFormValues)[] = [
  "assetId",
  "title",
  "description",
  "priority",
  "assignedTeam",
  "status",
];

const FIELD_LABELS: Record<keyof WorkOrderFormValues, string> = {
  assetId: "Asset",
  title: "Title",
  description: "Description",
  priority: "Priority",
  assignedTeam: "Assigned team",
  status: "Status",
};

function fieldId(field: keyof WorkOrderFormValues): string {
  return `wo-${field}`;
}

function isWorkOrderPriority(value: string): value is WorkOrderPriority {
  return PRIORITIES.some((priority) => priority === value);
}

function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return WORK_ORDER_STATUSES.some((status) => status === value);
}

export function WorkOrderForm({ assets }: { assets: Asset[] }) {
  const [values, setValues] = useState<WorkOrderFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<WorkOrderFieldErrors>({});
  const [storageError, setStorageError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update(field: keyof WorkOrderFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setStorageError(false);

    const fieldErrors = validateWorkOrderInput(values, assets);
    setErrors(fieldErrors);
    const firstInvalid = FIELD_ORDER.find((field) => fieldErrors[field] !== undefined);
    if (firstInvalid !== undefined) {
      document.getElementById(fieldId(firstInvalid))?.focus();
      return;
    }

    if (!isWorkOrderPriority(values.priority) || !isWorkOrderStatus(values.status)) {
      return;
    }

    setSubmitting(true);
    const result = createWorkOrder({
      assetId: values.assetId,
      title: values.title,
      description: values.description,
      priority: values.priority,
      assignedTeam: values.assignedTeam,
      status: values.status,
    });
    setSubmitting(false);

    if (!result.ok) {
      setStorageError(true);
      return;
    }
    window.location.assign(`/work-orders?created=${encodeURIComponent(result.workOrder.id)}`);
  }

  function renderError(field: keyof WorkOrderFormValues) {
    const error = errors[field];
    if (error === undefined) return null;
    return (
      <p id={`${fieldId(field)}-error`} className="text-xs text-critical">
        {error}
      </p>
    );
  }

  function describedBy(field: keyof WorkOrderFormValues) {
    return errors[field] !== undefined ? `${fieldId(field)}-error` : undefined;
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      data-slot="work-order-form"
      className="flex flex-col gap-4"
    >
      <div>
        <label htmlFor={fieldId("assetId")} className="mb-1.5 block text-xs font-semibold text-ink">
          {FIELD_LABELS.assetId}
        </label>
        <select
          id={fieldId("assetId")}
          name="assetId"
          value={values.assetId}
          onChange={(event) => update("assetId", event.target.value)}
          aria-invalid={errors.assetId !== undefined}
          aria-describedby={describedBy("assetId")}
          className={controlClasses}
        >
          <option value="">Select an asset</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} ({asset.id})
            </option>
          ))}
        </select>
        {renderError("assetId")}
      </div>

      <div>
        <label htmlFor={fieldId("title")} className="mb-1.5 block text-xs font-semibold text-ink">
          {FIELD_LABELS.title}
        </label>
        <input
          id={fieldId("title")}
          name="title"
          type="text"
          value={values.title}
          onChange={(event) => update("title", event.target.value)}
          maxLength={120}
          aria-invalid={errors.title !== undefined}
          aria-describedby={describedBy("title")}
          className={controlClasses}
        />
        {renderError("title")}
      </div>

      <div>
        <label
          htmlFor={fieldId("description")}
          className="mb-1.5 block text-xs font-semibold text-ink"
        >
          {FIELD_LABELS.description}
        </label>
        <textarea
          id={fieldId("description")}
          name="description"
          value={values.description}
          onChange={(event) => update("description", event.target.value)}
          rows={4}
          aria-invalid={errors.description !== undefined}
          aria-describedby={describedBy("description")}
          className={controlClasses}
        />
        {renderError("description")}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor={fieldId("priority")}
            className="mb-1.5 block text-xs font-semibold text-ink"
          >
            {FIELD_LABELS.priority}
          </label>
          <select
            id={fieldId("priority")}
            name="priority"
            value={values.priority}
            onChange={(event) => update("priority", event.target.value)}
            aria-invalid={errors.priority !== undefined}
            aria-describedby={describedBy("priority")}
            className={controlClasses}
          >
            <option value="">Select a priority</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </select>
          {renderError("priority")}
        </div>

        <div>
          <label
            htmlFor={fieldId("assignedTeam")}
            className="mb-1.5 block text-xs font-semibold text-ink"
          >
            {FIELD_LABELS.assignedTeam}
          </label>
          <select
            id={fieldId("assignedTeam")}
            name="assignedTeam"
            value={values.assignedTeam}
            onChange={(event) => update("assignedTeam", event.target.value)}
            aria-invalid={errors.assignedTeam !== undefined}
            aria-describedby={describedBy("assignedTeam")}
            className={controlClasses}
          >
            <option value="">Select a team</option>
            {TEAMS.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
          {renderError("assignedTeam")}
        </div>

        <div>
          <label
            htmlFor={fieldId("status")}
            className="mb-1.5 block text-xs font-semibold text-ink"
          >
            {FIELD_LABELS.status}
          </label>
          <select
            id={fieldId("status")}
            name="status"
            value={values.status}
            onChange={(event) => update("status", event.target.value)}
            aria-invalid={errors.status !== undefined}
            aria-describedby={describedBy("status")}
            className={controlClasses}
          >
            <option value="">Select a status</option>
            {WORK_ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          {renderError("status")}
        </div>
      </div>

      {storageError ? (
        <p
          role="alert"
          className="rounded-md border border-critical-line bg-critical-bg px-3 py-2 text-xs font-medium text-critical"
        >
          The work order was not saved because browser storage is unavailable in this profile.
        </p>
      ) : null}

      <div className="mt-1 flex items-center gap-3">
        <button type="submit" disabled={submitting} className={buttonPrimary}>
          {submitting ? "Saving…" : "Save work order"}
        </button>
        <a href="/work-orders" className={buttonSecondary}>
          Cancel
        </a>
      </div>
    </form>
  );
}
