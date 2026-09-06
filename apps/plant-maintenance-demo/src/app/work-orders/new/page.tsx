"use client";

import { WorkOrderForm } from "@/components/work-order-form";
import { PageHeading } from "@/components/page-heading";
import { PageSkeleton } from "@/components/page-skeleton";
import { StorageBanner } from "@/components/storage-banner";
import { usePlantState } from "@/lib/use-plant-state";

export default function NewWorkOrderPage() {
  const plant = usePlantState();

  if (plant === null) {
    return <PageSkeleton label="Loading work order form" />;
  }

  return (
    <div className="max-w-2xl">
      <PageHeading
        title="New work order"
        subtitle="Record maintenance work against a tracked asset. The work order is saved only when you submit the form."
      />
      <div className="rounded-lg border border-line bg-surface p-5">
        <WorkOrderForm assets={[...plant.state.assets]} />
      </div>
      <div className="mt-4">
        <StorageBanner visible={!plant.storageAvailable} />
      </div>
    </div>
  );
}
