"use client";

import { useEffect } from "react";
import { type Translate, useLocale } from "@/lib/i18n";

/**
 * Warns before losing unsaved edits (settings audit: "warn before navigating
 * away with unsaved changes"). Covers both real navigation — tab close, reload,
 * an in-app link to another route — and in-page category switches, which don't
 * trigger `beforeunload` and must call `confirmDiscard()` themselves before
 * switching away from a dirty category.
 *
 * Internal links intercepted at the document's capture phase: stopping
 * propagation there keeps the event from ever reaching the link's own click
 * handler (Next.js `Link`), so a cancelled confirm leaves navigation as a no-op.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const { t } = useLocale();

  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function onClickCapture(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      if (!window.confirm(t("unsavedChangesConfirm"))) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [dirty, t]);
}

/** Category-switch guard: returns false (and blocks the switch) when the user cancels. */
export function confirmDiscardUnsavedChanges(dirty: boolean, t: Translate) {
  if (!dirty) return true;
  return window.confirm(t("unsavedChangesConfirm"));
}
