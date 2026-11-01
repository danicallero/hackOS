"use client";

import { useRef } from "react";

/** H13/H21: controlled editors often open without a Radix Trigger. */
export function useFocusRestore({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: {
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const fallback = useRef<HTMLElement | null>(null);
  const surface = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Menu items disappear on selection; their owning menu button survives.
      const menu = opener.current?.closest('[role="menu"]');
      const menuTrigger = menu?.id
        ? [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(
            (node) => node.getAttribute("aria-controls") === menu.id,
          )
        : null;
      const siblings = opener.current?.parentElement
        ? [...opener.current.parentElement.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
          )].filter((node) => node !== opener.current)
        : [];
      fallback.current = menuTrigger ?? siblings[0] ?? null;
      surface.current = event.target instanceof HTMLElement ? event.target : null;
      onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const target = opener.current?.isConnected && opener.current !== document.body
        ? opener.current
        : fallback.current?.isConnected ? fallback.current : null;
      if (!target) return;
      // A non-modal overlay may have closed because focus moved outside it.
      // Keep that deliberate destination rather than pulling focus back.
      const active = document.activeElement;
      if (active !== document.body && !surface.current?.contains(active)) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    },
  };
}
