export function AppFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-4 text-xs text-ink-faint sm:px-6">
        <p>
          PlantOps is a local demonstration system built for the Anchor OS browser-control demo. All
          assets, maintenance records, and work orders are synthetic demonstration data.
        </p>
        <p>
          There is no API or automation endpoint. The workflow runs through the same visible
          controls a human operator uses.
        </p>
      </div>
    </footer>
  );
}
