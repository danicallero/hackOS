"use client";

import { useContext, useEffect, useRef } from "react";
import {
  requestDiscardConfirmation,
  UnsavedChangesContext,
} from "@/components/common/unsaved-changes-provider";
import type { Translate } from "@/lib/i18n";

/**
 * Warns before losing unsaved edits (settings audit: "warn before navigating
 * away with unsaved changes"). Covers both real navigation — tab close, reload,
 * an in-app link to another route — and in-page category switches, which don't
 * trigger `beforeunload` and must call `confirmDiscard()` themselves before
 * switching away from a dirty category.
 *
 * Browser Back / swipe-back is covered only when `guardBrowserBack` is set
 * (off by default; event settings opts in): a sentinel history entry is pushed
 * while dirty, Back first pops it (same URL, nothing unmounts), and the popstate
 * handler re-arms it before opening the alert, so repeated Back stays safe;
 * accepting skips both current-page entries. It
 * is pushed once per dirty period, never on rerender (R003); after a save the
 * spent entry stays, so one extra Back lands on the same URL. Without the
 * option no history entry is pushed and no popstate listener is registered.
 *
 * Internal links intercepted at the document's capture phase: stopping
 * propagation there keeps the event from ever reaching the link's own click
 * handler (Next.js `Link`), so a cancelled confirm leaves navigation as a no-op.
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  { guardBrowserBack = false }: { guardBrowserBack?: boolean } = {},
) {
  const { register, confirm, navigate } = useContext(UnsavedChangesContext);
  const owner = useRef({});
  const armed = useRef(false);
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!dirty) {
      armed.current = false;
      return;
    }
    const unregister = register(owner.current);
    let active = true;
    let leaving = false;
    let decidingBack = false;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function onClickCapture(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      event.preventDefault();
      event.stopPropagation();
      void confirmRef.current().then((accepted) => {
        if (!active || !accepted || leaving) return;
        leaving = true;
        window.removeEventListener("beforeunload", onBeforeUnload);
        navigateRef.current(url.href);
      });
    }

    function arm() {
      if (armed.current) return;
      armed.current = true;
      window.history.pushState(window.history.state, "", window.location.href);
    }

    function onPopState() {
      if (leaving) return;
      armed.current = false;
      arm();
      if (decidingBack) return;
      decidingBack = true;
      void confirmRef.current().then((accepted) => {
        if (!active || leaving) return;
        decidingBack = false;
        if (accepted) {
          leaving = true;
          window.removeEventListener("beforeunload", onBeforeUnload);
          window.removeEventListener("popstate", onPopState);
          window.history.go(-2);
        }
      });
    }

    if (guardBrowserBack) {
      arm();
      window.addEventListener("popstate", onPopState);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      active = false;
      unregister();
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty, guardBrowserBack, register]);
}

/** Category-switch guard: returns false (and blocks the switch) when the user cancels. */
export async function confirmDiscardUnsavedChanges(dirty: boolean, _t: Translate) {
  if (!dirty) return true;
  return requestDiscardConfirmation();
}
