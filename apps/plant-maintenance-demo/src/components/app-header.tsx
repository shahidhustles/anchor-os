"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { resetDemo } from "@/lib/maintenance-store";

const NAV_ITEMS = [
  { href: "/assets", label: "Assets" },
  { href: "/work-orders", label: "Work orders" },
] as const;

function ResetDemoControl() {
  const [confirming, setConfirming] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!confirming) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirming(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirming]);

  function handleReset() {
    const result = resetDemo();
    setConfirming(false);
    setResetDone(result.ok);
    setResetFailed(!result.ok);
    regionRef.current?.focus();
  }

  return (
    <div ref={regionRef} tabIndex={-1} className="flex items-center gap-2 focus:outline-none">
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Confirm reset demo data"
          className="flex items-center gap-2 rounded-md border border-line-strong bg-canvas px-3 py-1"
        >
          <span className="text-sm font-medium text-ink">Reset demo data?</span>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md bg-ember px-2.5 py-1 text-xs font-semibold text-[#fafaf9] hover:bg-ember-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            Keep data
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setResetDone(false);
            setResetFailed(false);
            setConfirming(true);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-ink-muted hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Reset demo data
        </button>
      )}
      {resetDone ? (
        <span role="status" className="text-xs font-medium text-ok">
          Demo data reset.
        </span>
      ) : null}
      {resetFailed ? (
        <span role="alert" className="text-xs font-medium text-critical">
          Could not reset demo data because browser storage is unavailable.
        </span>
      ) : null}
    </div>
  );
}

export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link href="/assets" aria-label="PlantOps home" className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-ember" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">PlantOps</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            Local demo
          </span>
        </Link>
        <nav aria-label="Primary" className="ml-2 flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ember ${
                  active
                    ? "bg-ember-tint text-ember-deep"
                    : "text-ink-muted hover:bg-canvas hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ResetDemoControl />
          <Link
            href="/work-orders/new"
            className="rounded-md bg-ember px-3 py-1.5 text-sm font-semibold text-[#fafaf9] hover:bg-ember-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            New work order
          </Link>
        </div>
      </div>
    </header>
  );
}
