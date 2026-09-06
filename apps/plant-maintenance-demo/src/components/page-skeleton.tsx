export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} data-slot="page-loading" className="w-full">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <div className="h-7 w-48 rounded-md bg-line" />
        <div className="h-16 max-w-md rounded-md bg-line" />
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="h-9 border-b border-line-strong bg-canvas" />
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="h-4 w-20 rounded bg-line" />
              <div className="h-4 w-40 rounded bg-line" />
              <div className="h-4 w-32 rounded bg-line" />
              <div className="ml-auto h-4 w-16 rounded bg-line" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
