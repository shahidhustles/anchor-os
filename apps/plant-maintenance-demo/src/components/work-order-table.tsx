import Link from "next/link";

import type { Asset, WorkOrder } from "@/data/seed";
import { formatDate } from "@/lib/maintenance-store";
import { StatusBadge, priorityTone, workOrderStatusTone } from "./status-badge";

export function WorkOrdersTable({
  workOrders,
  assets,
  highlightId,
}: {
  workOrders: readonly WorkOrder[];
  assets: readonly Asset[];
  highlightId?: string;
}) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <div
      className="overflow-x-auto rounded-lg border border-line bg-surface"
      data-slot="work-orders-table"
    >
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <caption className="sr-only">Work orders, newest first</caption>
        <thead>
          <tr className="border-b border-line-strong">
            {["Work order", "Asset", "Priority", "Assigned team", "Status", "Created"].map(
              (heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="px-4 py-2.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {workOrders.map((workOrder) => {
            const asset = assetById.get(workOrder.assetId);
            const highlighted = highlightId !== undefined && highlightId === workOrder.id;
            return (
              <tr
                key={workOrder.id}
                className={`border-b border-line last:border-b-0 hover:bg-canvas ${
                  highlighted
                    ? "border-l-[3px] border-l-ember bg-ember-tint hover:bg-ember-tint"
                    : ""
                }`}
              >
                <td className="max-w-[320px] px-4 py-3">
                  <Link
                    href={`/work-orders/${workOrder.id}`}
                    className="font-mono text-[13px] font-semibold text-ember hover:text-ember-deep hover:underline"
                  >
                    {workOrder.id}
                  </Link>
                  <p className="mt-0.5 truncate text-ink" title={workOrder.title}>
                    {workOrder.title}
                  </p>
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  {asset !== undefined ? (
                    <Link href={`/assets/${asset.id}`} className="hover:text-ember hover:underline">
                      {asset.name}
                    </Link>
                  ) : (
                    workOrder.assetId
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge label={workOrder.priority} tone={priorityTone(workOrder.priority)} />
                </td>
                <td className="px-4 py-3 text-ink-muted">{workOrder.assignedTeam}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    label={workOrder.status}
                    tone={workOrderStatusTone(workOrder.status)}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-[13px] whitespace-nowrap text-ink-faint">
                  {formatDate(workOrder.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
