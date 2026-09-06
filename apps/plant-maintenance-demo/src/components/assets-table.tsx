import Link from "next/link";

import type { Asset } from "@/data/seed";
import { StatusBadge, operatingStatusTone } from "./status-badge";

export function AssetsTable({
  assets,
  query,
  onClearQuery,
}: {
  assets: Asset[];
  query: string;
  onClearQuery: () => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-lg border border-line bg-surface"
      data-slot="assets-table"
    >
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">Plant assets</caption>
        <thead>
          <tr className="border-b border-line-strong">
            {["Asset ID", "Name", "Type", "Location", "Status"].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-4 py-2.5 text-[11px] font-semibold tracking-wide text-ink-faint uppercase"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center">
                <p className="text-sm font-medium text-ink">
                  No assets match &ldquo;{query}&rdquo;.
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Try a different name, ID, type, or location.
                </p>
                <button
                  type="button"
                  onClick={onClearQuery}
                  className="mt-4 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  Clear search
                </button>
              </td>
            </tr>
          ) : (
            assets.map((asset) => (
              <tr key={asset.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                <td className="px-4 py-3 font-mono text-[13px] text-ink">{asset.id}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/assets/${asset.id}`}
                    className="font-medium text-ember hover:text-ember-deep hover:underline"
                  >
                    {asset.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-muted">{asset.type}</td>
                <td className="px-4 py-3 text-ink-muted">{asset.location}</td>
                <td className="px-4 py-3">
                  <StatusBadge
                    label={asset.operatingStatus}
                    tone={operatingStatusTone(asset.operatingStatus)}
                  />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
