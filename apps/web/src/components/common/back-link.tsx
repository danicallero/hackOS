"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { canGoBackInApp } from "@/lib/nav-history";

/**
 * The parent-crumb link for `PageHeader`'s `context` slot on detail/edit
 * pages (docs/DESIGN.md §4: "context is the parent crumb, not a second back
 * button"). Prefers a real browser back-navigation (which lands on the exact
 * list state — filters, pagination, scroll position — the user left) over a
 * fresh push to `href`, falling back to `href` only when there's no in-app
 * page to return to (e.g. the detail page was opened directly).
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
      className="type-meta hover:text-foreground inline-flex items-center gap-1"
    >
      <ArrowLeftIcon className="size-3" aria-hidden="true" />
      {label}
    </button>
  );
}
