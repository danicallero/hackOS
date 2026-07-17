"use client";

import { usePathname } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { PERSONAL_NAV, WORKSPACES } from "@/lib/nav";

/**
 * Current location shown in the top bar (Dokploy-style breadcrumb). This is the
 * nav item's name — section cards on the page carry their own titles, so it
 * doesn't duplicate them.
 */
export function HeaderTitle() {
  const pathname = usePathname();
  const { t } = useLocale();
  const item = [...PERSONAL_NAV, ...WORKSPACES.flatMap((w) => w.items)]
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <span className="text-muted-foreground text-sm font-medium">
      {item ? t(item.title) : "hackOS"}
    </span>
  );
}
