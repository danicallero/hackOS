"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * hackOS wordmark. Single source for the brand lockup — reuse it in the auth
 * shell, the sidebar header and anywhere the product name appears, so the mark
 * never drifts between screens.
 */
export function Brand({
  className,
  showText = true,
}: {
  className?: string;
  /** Hides the "hackOS" text, leaving just the mark — e.g. a favicon-sized slot. */
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-[0.2em] text-2xl font-bold", className)}>
      <BrandMark className="size-[1.3em]" />
      {showText && <span className="tracking-tight">hackOS</span>}
    </span>
  );
}

/**
 * hackOS "iso" mark — same brand icon as the mobile app splash screen.
 * Fetched from the single source file (public/icons/brand-mark.svg) and
 * recolored to currentColor so it matches the surrounding text.
 */
export function BrandMark({ className }: { className?: string }) {
  const [markup, setMarkup] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/icons/brand-mark.svg")
      .then((res) => res.text())
      .then((svg) => {
        if (cancelled) return;
        setMarkup(
          svg
            .replace(/fill:\s*#[0-9a-fA-F]+/g, "fill:currentColor")
            .replace("<svg ", '<svg width="100%" height="100%" '),
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <span
      className={cn("inline-block text-current", className)}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin static asset (public/icons/brand-mark.svg), not user input.
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
    />
  );
}
