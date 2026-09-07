"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { NotFoundPanel } from "@/components/not-found-panel";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge, priorityTone, workOrderStatusTone } from "@/components/status-badge";
import { WorkOrderPriorityEditor } from "@/components/work-order-priority-editor";
import { formatDateTime } from "@/lib/maintenance-store";
import { usePlantState } from "@/lib/use-plant-state";
import { linkButton } from "@/lib/ui";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {label}
      </dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const plant = usePlantState();

  if (plant === null) {
    return <PageSkeleton label="Loading work order" />;
  }

  const workOrder = plant.state.workOrders.find((candidate) => candidate.id === workOrderId);

  if (workOrder === undefined) {
    return (
      <NotFoundPanel
        title="Work order not found"
        detail={`No work order with ID “${workOrderId}” exists in this demonstration plant.`}
        backHref="/work-orders"
        backLabel="Back to work orders"
      />
    );
  }

  const asset = plant.state.assets.find((candidate) => candidate.id === workOrder.assetId);

  return (
    <div>
      <Link href="/work-orders" className={`inline-block ${linkButton}`}>
        Back to work orders
      </Link>
      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-lg font-semibold tracking-tight text-ink">{workOrder.id}</h1>
        <StatusBadge label={workOrder.priority} tone={priorityTone(workOrder.priority)} />
        <StatusBadge label={workOrder.status} tone={workOrderStatusTone(workOrder.status)} />
      </div>

      <p className="mb-5 text-base font-medium text-ink">{workOrder.title}</p>

      <dl className="rounded-lg border border-line bg-surface" data-slot="work-order-detail">
        <DetailRow label="Asset">
          {asset !== undefined ? (
            <Link
              href={`/assets/${asset.id}`}
              className="text-ember hover:text-ember-deep hover:underline"
            >
              {asset.name}{" "}
              <span className="font-mono text-[13px] text-ink-muted">({asset.id})</span>
            </Link>
          ) : (
            workOrder.assetId
          )}
        </DetailRow>
        <DetailRow label="Priority">
          <StatusBadge label={workOrder.priority} tone={priorityTone(workOrder.priority)} />
        </DetailRow>
        <DetailRow label="Assigned team">{workOrder.assignedTeam}</DetailRow>
        <DetailRow label="Status">
          <StatusBadge label={workOrder.status} tone={workOrderStatusTone(workOrder.status)} />
        </DetailRow>
        <DetailRow label="Created">
          <span className="font-mono text-[13px] text-ink">
            {formatDateTime(workOrder.createdAt)}
          </span>
        </DetailRow>
        <DetailRow label="Description">
          <span className="text-sm text-ink-muted">{workOrder.description}</span>
        </DetailRow>
      </dl>

      <WorkOrderPriorityEditor workOrderId={workOrder.id} priority={workOrder.priority} />
    </div>
  );
}
