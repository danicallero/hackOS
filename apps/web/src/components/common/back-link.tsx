"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { canGoBackInApp } from "@/lib/nav-history";

/**
 * A "‹ Back" navigation control for the top of a detail/edit page. Prefers a
 * real browser back-navigation (which lands on the exact list state —
 * filters, pagination, scroll position — the user left) over a fresh push to
 * `href`, falling back to `href` only when there's no in-app page to return
 * to (e.g. the detail page was opened directly).
 */
export function BackLink({
  href,
  label,
}: {
  /** Fallback destination when there's no in-app history to go back to. */
  href: string;
  /** Text (or richer node) shown next to the arrow icon. */
  label: ReactNode;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (canGoBackInApp() ? router.back() : router.push(href))}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </button>
  );
}
