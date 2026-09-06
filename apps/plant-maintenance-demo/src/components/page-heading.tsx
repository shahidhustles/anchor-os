export function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle !== undefined ? (
        <p className="mt-1 max-w-[65ch] text-sm text-ink-muted">{subtitle}</p>
      ) : null}
    </header>
  );
}
