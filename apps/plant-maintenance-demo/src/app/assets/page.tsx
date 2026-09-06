"use client";

import { useMemo, useState } from "react";

import { AssetsTable } from "@/components/assets-table";
import { PageHeading } from "@/components/page-heading";
import { PageSkeleton } from "@/components/page-skeleton";
import { StorageBanner } from "@/components/storage-banner";
import { filterAssets } from "@/lib/maintenance-store";
import { usePlantState } from "@/lib/use-plant-state";
import { controlClasses } from "@/lib/ui";

export default function AssetsPage() {
  const plant = usePlantState();
  const [query, setQuery] = useState("");

  const assets = useMemo(() => {
    if (plant === null) return [];
    return filterAssets(plant.state.assets, query);
  }, [plant, query]);

  if (plant === null) {
    return <PageSkeleton label="Loading assets" />;
  }

  return (
    <div>
      <PageHeading title="Assets" subtitle="Tracked equipment in the demonstration plant." />
      <div className="mb-4 max-w-md">
        <label htmlFor="asset-search" className="mb-1.5 block text-xs font-semibold text-ink">
          Search assets
        </label>
        <input
          id="asset-search"
          name="asset-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, ID, type, or location"
          className={controlClasses}
        />
      </div>
      <p aria-live="polite" className="mb-2 text-xs text-ink-faint">
        {assets.length === plant.state.assets.length
          ? `${assets.length} assets`
          : `Showing ${assets.length} of ${plant.state.assets.length} assets`}
      </p>
      <AssetsTable assets={assets} query={query} onClearQuery={() => setQuery("")} />
      <div className="mt-4">
        <StorageBanner visible={!plant.storageAvailable} />
      </div>
    </div>
  );
}
