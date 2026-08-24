"use client";

import { useEffect, useRef } from "react";

/**
 * Restores the window scroll position saved under `key` once `ready` (e.g.
 * the list has finished loading), and keeps saving the current position
 * while the page is visited — so a later BackLink return lands where the
 * user left off instead of at the top. Pass `key: null` to disable (no-op).
 */
export function useScrollRestoration(key: string | null, ready: boolean): void {
  const restored = useRef(false);

  useEffect(() => {
    if (!key || !ready || restored.current) return;
    restored.current = true;
    const raw = window.sessionStorage.getItem(key);
    const y = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(y) && y > 0) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  }, [key, ready]);

  useEffect(() => {
    if (!key) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        window.sessionStorage.setItem(key, String(window.scrollY));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
}
