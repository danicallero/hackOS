"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { type MessageKey, useLocale } from "@/lib/i18n";

const TARGET_SELECTOR = "h1,h2,h3,h4,legend,label,button,summary,[role=tab],p,span";
const GIVE_UP_MS = 4000;

function normalize(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisible(element: HTMLElement): boolean {
  if (getComputedStyle(element).visibility === "hidden") return false;
  // Without a layout engine (unit tests) there are no rects: fall back to the hidden attribute.
  if (document.documentElement.getClientRects().length === 0) {
    return !element.closest("[hidden]");
  }
  return element.getClientRects().length > 0;
}

/** The deepest visible element whose own text is exactly `text`. */
export function findQuickTarget(root: ParentNode, text: string): HTMLElement | null {
  const wanted = normalize(text);
  if (!wanted) return null;
  for (const element of root.querySelectorAll<HTMLElement>(TARGET_SELECTOR)) {
    if (normalize(element.textContent) !== wanted) continue;
    if (Array.from(element.children).some((child) => normalize(child.textContent) === wanted)) {
      continue;
    }
    if (isVisible(element)) return element;
  }
  return null;
}

/** Brings the match into view, focuses its control, and optionally activates it. */
export function arriveAt(element: HTMLElement, click: boolean) {
  element.scrollIntoView({ block: "center" });
  const control =
    element instanceof HTMLLabelElement
      ? element.control
      : element.closest<HTMLElement>("button,a,[role=tab]");
  const row = element.closest("li,[role=group],section") ?? element.parentElement;
  const action = control ?? row?.querySelector<HTMLElement>("button:not([disabled])");
  if (click && action) {
    action.click();
    return;
  }
  (control ?? element).focus?.({ preventScroll: true });
  const previous = element.style.outline;
  element.style.outline = "2px solid var(--ring, currentColor)";
  element.style.outlineOffset = "4px";
  window.setTimeout(() => {
    element.style.outline = previous;
    element.style.outlineOffset = "";
  }, 1800);
}

/**
 * Lands quick-search results on the section, field or action inside a page:
 * `?go=<message key>` names what to find by its visible label and `do=click`
 * activates it (#1182). The params are consumed once handled or after a short
 * wait, so reloads and shared links never repeat the jump (R003).
 */
export function QuickArrival() {
  const { t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const go = searchParams.get("go");
  const act = searchParams.get("do");
  const query = searchParams.toString();

  useEffect(() => {
    if (!go) return;
    const text = t(go as MessageKey);
    let done = false;
    const finish = (element: HTMLElement | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      window.clearTimeout(timeout);
      if (element) arriveAt(element, act === "click");
      const params = new URLSearchParams(query);
      params.delete("go");
      params.delete("do");
      const rest = params.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
    };
    const attempt = () => {
      const found = findQuickTarget(document, text);
      if (found) finish(found);
    };
    const observer = new MutationObserver(attempt);
    const timeout = window.setTimeout(() => finish(null), GIVE_UP_MS);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    attempt();
    return () => {
      done = true;
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [go, act, query, pathname, router, t]);

  return null;
}
