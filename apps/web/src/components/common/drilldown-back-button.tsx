"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";

/**
 * This changes only `?role=`/`tab` state rather than routes, so its in-page
 * return behavior stays separate from browser navigation.
 */
export function DrilldownBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="button-interaction text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {label}
    </button>
  );
}
