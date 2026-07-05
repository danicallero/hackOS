"use client";

import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/** Current section name in the top bar, derived from the nav model. */
export function HeaderTitle() {
  const pathname = usePathname();
  const item = NAV.flatMap((s) => s.items)
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return <span className="text-sm font-medium">{item?.title ?? "hackOS"}</span>;
}
