"use client";

import { useState } from "react";

/**
 * Where a Radix popover should be portaled when its trigger lives inside a
 * <Modal>/<Dialog>.
 *
 * Body (the default) is outside the dialog's scroll-lock (react-remove-scroll),
 * so the option list silently refuses to scroll. Rendering inline instead keeps
 * it inside the lock, but the modal body's `overflow-y-auto` then clips the
 * list — it hangs off the dialog and gets cut mid-option. The dialog panel is
 * inside the lock *and* outside that scroller, so it satisfies both; using it as
 * the collision boundary as well makes the popover flip/shrink to stay within
 * the dialog.
 *
 * Attach `ref` to any element inside the dialog and spread `props` onto the
 * `Popover.Portal` / `Popover.Content`. Outside a dialog (or when `inDialog` is
 * false) both are empty and the popover portals to the body as usual.
 */
export function useDialogPortal(inDialog: boolean) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const container = inDialog
    ? ((anchor?.closest('[data-slot="dialog-content"]') as HTMLElement | null) ?? null)
    : null;

  return {
    ref: setAnchor,
    portalProps: container ? { container } : {},
    contentProps: container ? { collisionBoundary: container } : {},
  };
}
