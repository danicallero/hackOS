"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { bumpNavDepth } from "@/lib/nav-history";

/**
 * Mounted once near the app root. Bumps a per-tab navigation counter every
 * time the route actually changes (not on first mount), so BackLink can
 * distinguish "there's an in-app page to go back to" from a fresh/direct
 * load of the current page.
 */
export function useTrackNavigation(): void {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (prev.current !== null && prev.current !== pathname) bumpNavDepth();
    prev.current = pathname;
  }, [pathname]);
}
