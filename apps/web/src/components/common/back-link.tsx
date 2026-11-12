"use client";

import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { previousInAppLocation } from "@/lib/in-app-history";
import { cn } from "@/lib/utils";

/**
 * The one way back from a record page, placed in `PageHeader`'s `context`.
 * `href` is the canonical parent and `label` its name. When the entry just
 * below this page in browser history is that parent, it steps back so the
 * list keeps its search, filters, page and scroll; otherwise (new tab, deep
 * link, refresh, arrived from elsewhere) it goes to `href`. Never leaves the
 * app, and does nothing when already at `href` (R003).
 */
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

  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = new URL(href, window.location.href);
    if (target.href === window.location.href) {
      event.preventDefault();
      return;
    }
    const previous = previousInAppLocation();
    if (previous && new URL(previous, window.location.href).pathname === target.pathname) {
      event.preventDefault();
      router.back();
    }
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={t("backToParent", { name: label })}
      className={cn(
        "button-interaction type-meta inline-flex items-center gap-1 transition-colors hover:text-foreground",
        className,
      )}
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}
