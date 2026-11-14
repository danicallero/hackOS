"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useLocale } from "@/lib/i18n";
import { previousInAppEntry, subscribeInAppHistory } from "@/lib/in-app-history";
import { cn } from "@/lib/utils";

/** Returns to the known in-app origin, or the canonical parent for direct visits. */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const previous = useSyncExternalStore(subscribeInAppHistory, previousInAppEntry, () => null);
  const parentPath = href.split("?")[0];
  const previousPath = previous?.url.split("?")[0];
  const samePage = typeof window !== "undefined" && previousPath === window.location.pathname;
  const origin =
    previous && !samePage && (previous.label || previousPath === parentPath) ? previous : null;
  const targetHref = origin?.url ?? href;
  const targetLabel = origin?.label ?? label;

  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(targetHref, window.location.href);
    if (target.href === window.location.href) {
      event.preventDefault();
      return;
    }
    if (origin && previousInAppEntry()?.url === origin.url) {
      event.preventDefault();
      router.back();
    }
  }

  return (
    <Link
      href={targetHref}
      onClick={onClick}
      data-back-link=""
      aria-label={t("backToParent", { name: targetLabel })}
      className={cn(
        // Padding gives the hover fill room around the text; the matching
        // negative margin keeps the arrow aligned with the page title.
        "button-interaction type-meta -mx-2 -my-1 inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors hover:text-foreground",
        className,
      )}
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {targetLabel}
    </Link>
  );
}
