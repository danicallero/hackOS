"use client";

import { useEffect } from "react";

// Radix popovers/selects/dropdowns render their content in a portal outside
// the trigger's DOM subtree, so a naive "outside the ref" check would treat
// picking an option as a click outside — ignore anything landing in one.
const PORTAL_CONTENT_SELECTOR = '[data-slot$="-content"]';

/** Collapses an expanded card/row when the user clicks anywhere outside it
 *  (H11 question builder, judging panel builder — issue reported: expanded
 *  cards had no way to collapse except opening another one). */
export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  onOutside: () => void,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (ref.current?.contains(target)) return;
      if (target instanceof Element && target.closest(PORTAL_CONTENT_SELECTOR)) return;
      onOutside();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [ref, onOutside, enabled]);
}
