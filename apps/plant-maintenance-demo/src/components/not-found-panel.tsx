import Link from "next/link";

import { linkButton } from "@/lib/ui";

export function NotFoundPanel({
  title,
  detail,
  backHref,
  backLabel,
}: {
  title: string;
  detail: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-8" data-slot="not-found">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-1 max-w-[65ch] text-sm text-ink-muted">{detail}</p>
      <Link href={backHref} className={`mt-4 inline-block ${linkButton}`}>
        {backLabel}
      </Link>
    </section>
  );
}
