"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { MAIN_CONTENT_ID } from "@/components/layout/skip-link";

/** H49/H55: announce the new route; leave initial load and history scroll restoration alone. */
export function RouteFocus() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const historyNavigation = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      historyNavigation.current = window.location.pathname !== previousPath.current;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const restoreScroll = historyNavigation.current;
    historyNavigation.current = false;
    if (window.location.hash || pathname.startsWith("/tv")) return;
    const frame = requestAnimationFrame(() => {
      const main = document.getElementById(MAIN_CONTENT_ID);
      main?.focus({ preventScroll: true });
      if (!restoreScroll) window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return null;
}
