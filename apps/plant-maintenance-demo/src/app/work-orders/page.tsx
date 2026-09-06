"use client";

import { Suspense } from "react";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { PageHeading } from "@/components/page-heading";
import { PageSkeleton } from "@/components/page-skeleton";
import { StorageBanner } from "@/components/storage-banner";
import { WorkOrdersTable } from "@/components/work-order-table";
import { sortWorkOrdersNewestFirst } from "@/lib/maintenance-store";
import { usePlantState } from "@/lib/use-plant-state";

function WorkOrdersContent() {
  const searchParams = useSearchParams();
  const created = searchParams.get("created") ?? undefined;
  const plant = usePlantState();

  if (plant === null) {
    return <PageSkeleton label="Loading work orders" />;
  }

  const workOrders = sortWorkOrdersNewestFirst(plant.state.workOrders);
  const createdWorkOrder =
    created !== undefined ? workOrders.find((wo) => wo.id === created) : undefined;

  return (
    <div>
      <PageHeading
        title="Work orders"
        subtitle="Maintenance work tracked in the demonstration plant."
      />

      {createdWorkOrder !== undefined ? (
        <div
          role="status"
          data-slot="work-order-created"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-ok-line bg-ok-bg px-4 py-3"
        >
          <p className="text-sm font-medium text-ok">
            Work order {createdWorkOrder.id} saved and now appears at the top of the list.
          </p>
          <Link
            href={`/work-orders/${createdWorkOrder.id}`}
            className="text-sm font-semibold text-ok underline"
          >
            View work order
          </Link>
        </div>
      ) : null}

      {workOrders.length === 0 ? (
        <div
          className="rounded-lg border border-line bg-surface px-4 py-10 text-center"
          data-slot="work-orders-empty"
        >
          <p className="text-sm font-medium text-ink">No work orders yet.</p>
          <p className="mt-1 text-xs text-ink-muted">
            Use “New work order” in the header to create the first one.
          </p>
        </div>
      ) : (
        <WorkOrdersTable
          workOrders={workOrders}
          assets={plant.state.assets}
          highlightId={createdWorkOrder?.id}
        />
      )}

      <div className="mt-4">
        <StorageBanner visible={!plant.storageAvailable} />
      </div>
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <Suspense fallback={<PageSkeleton label="Loading work orders" />}>
      <WorkOrdersContent />
    </Suspense>
  );
}
