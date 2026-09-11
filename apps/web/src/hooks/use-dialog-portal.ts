"use client";

import {
  createContext,
  type ForwardedRef,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export const OVERLAY_CONTAINER_SELECTOR =
  '[data-slot="dialog-content"], [data-slot="sheet-content"], [data-slot="alert-dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"]';

export function getOverlayContainer(anchor: HTMLElement | null) {
  return anchor?.closest<HTMLElement>(OVERLAY_CONTAINER_SELECTOR) ?? null;
}

export interface OverlayPortalContextValue {
  anchor: HTMLElement | null;
  container: HTMLElement | null;
  registerAnchor: (node: HTMLElement | null) => void;
}

export const OverlayPortalContext = createContext<OverlayPortalContextValue | null>(null);

export function useOverlayPortalState(): OverlayPortalContextValue {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const registerAnchor = useCallback((node: HTMLElement | null) => {
    setAnchor((current) => (current === node ? current : node));
  }, []);
  const container = getOverlayContainer(anchor);

  return useMemo(
    () => ({ anchor, container, registerAnchor }),
    [anchor, container, registerAnchor],
  );
}

export function useOverlayPortalContext() {
  return useContext(OverlayPortalContext);
}

export function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

/**
 * Where a Radix popover should be portaled when its trigger lives inside an
 * overlay such as a <Modal>/<Dialog>/<SidePanelEditor>, AlertModal, popover,
 * menu, or select.
 *
 * Body (the default) is outside the dialog's scroll-lock (react-remove-scroll),
 * so the option list silently refuses to scroll. Rendering inline instead keeps
 * it inside the lock, but the modal body's `overflow-y-auto` then clips the
 * list — it hangs off the dialog and gets cut mid-option. The dialog panel is
 * inside the lock *and* outside that scroller, so it satisfies both; using it as
 * the collision boundary as well makes the popover flip/shrink to stay within
 * the dialog.
 *
 * Attach `ref` to any element inside the overlay and spread `props` onto the
 * `Popover.Portal` / `Popover.Content`. Outside an overlay (or when `inDialog`
 * is false) both are empty and the popover portals to the body as usual.
 */
export function useDialogPortal(inDialog: boolean) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const container = inDialog ? getOverlayContainer(anchor) : null;

  return {
    ref: setAnchor,
    portalProps: container ? { container } : {},
    contentProps: container ? { collisionBoundary: container } : {},
  };
}
