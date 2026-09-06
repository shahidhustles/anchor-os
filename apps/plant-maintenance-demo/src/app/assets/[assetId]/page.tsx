"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { NotFoundPanel } from "@/components/not-found-panel";
import { PageSkeleton } from "@/components/page-skeleton";
import { StatusBadge, operatingStatusTone } from "@/components/status-badge";
import { formatDate } from "@/lib/maintenance-store";
import { usePlantState } from "@/lib/use-plant-state";
import { linkButton } from "@/lib/ui";

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-40 shrink-0 text-xs font-semibold tracking-wide text-ink-faint uppercase">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-[13px] text-ink" : "text-sm text-ink"}>{value}</dd>
    </div>
  );
}

export default function AssetDetailPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const plant = usePlantState();

  if (plant === null) {
    return <PageSkeleton label="Loading asset" />;
  }

  const asset = plant.state.assets.find((candidate) => candidate.id === assetId);

  if (asset === undefined) {
    return (
      <NotFoundPanel
        title="Asset not found"
        detail={`No asset with ID “${assetId}” exists in this demonstration plant.`}
        backHref="/assets"
        backLabel="Back to assets"
      />
    );
  }

  return (
    <div>
      <Link href="/assets" className={`inline-block ${linkButton}`}>
        Back to assets
      </Link>
      <div className="mt-3 mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{asset.name}</h1>
        <StatusBadge
          label={asset.operatingStatus}
          tone={operatingStatusTone(asset.operatingStatus)}
        />
      </div>

      <dl className="rounded-lg border border-line bg-surface" data-slot="asset-detail">
        <DetailRow label="Asset ID" value={asset.id} mono />
        <DetailRow label="Name" value={asset.name} />
        <DetailRow label="Type" value={asset.type} />
        <DetailRow label="Location" value={asset.location} />
        <DetailRow label="Operating status" value={asset.operatingStatus} />
        <DetailRow label="Model" value={asset.model} />
        <DetailRow label="Installed" value={asset.installed} mono />
      </dl>

      <h2 className="mt-6 mb-2 text-sm font-semibold tracking-wide text-ink uppercase">
        Prior maintenance
      </h2>
      {asset.maintenance.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          No maintenance recorded for this asset yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-slot="asset-maintenance">
          {asset.maintenance.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] text-ink">{formatDate(entry.date)}</span>
                <StatusBadge
                  label={entry.kind}
                  tone={entry.kind === "Corrective" ? "warn" : "neutral"}
                />
                <span className="text-xs text-ink-faint">{entry.technician}</span>
              </div>
              <p className="mt-1.5 text-sm text-ink-muted">{entry.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
