"use client";

// List motion (docs/DESIGN.md §2 "List motion"): rows enter and leave with
// height + opacity, and a state change crossfades its marker/action area
// instead of snapping. Reduced motion removes all of it.

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Shared duration; keep in sync with `--list-motion-duration` in globals.css. */
export const LIST_MOTION_MS = 150;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Cell content wrapper for animated tables. The cell's padding lives in the
 * innermost element so the row can collapse to zero height.
 */
export function RowMotionCell({
  children,
  padding = "p-2",
}: {
  children: ReactNode;
  padding?: string;
}) {
  return (
    <div className="list-cell">
      <div className="list-cell-inner">
        <div className={padding}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Drives one row's presence. `entering` rows start collapsed and open;
 * `exiting` rows (kept as a ghost by `useRowPresence`) start open and close,
 * then report `onExited` so the ghost can be dropped.
 */
export function useRowMotion({
  entering,
  exiting,
  onExited,
}: {
  entering: boolean;
  exiting: boolean;
  onExited?: () => void;
}) {
  const [open, setOpen] = useState(!entering);
  const [animating, setAnimating] = useState(entering || exiting);
  const exitedRef = useRef(onExited);
  useEffect(() => {
    exitedRef.current = onExited;
  });

  useEffect(() => {
    if (!entering && !exiting) return;
    let frame2 = 0;
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => setOpen(exiting ? false : true));
    });
    const done = setTimeout(() => {
      setAnimating(false);
      if (exiting) exitedRef.current?.();
    }, LIST_MOTION_MS + 60);
    return () => {
      cancelAnimationFrame(frame1);
      cancelAnimationFrame(frame2);
      clearTimeout(done);
    };
  }, [entering, exiting]);

  return { open, animating };
}

export interface PresenceItem<T> {
  row: T;
  id: string;
  entering: boolean;
  exiting: boolean;
}

/**
 * Keeps a removed row mounted as a ghost until it has collapsed and flags rows
 * that appear after the first load. Only changes to `allIds` (the whole
 * dataset) animate; paging, search and sort never do.
 */
export function useRowPresence<T>(
  rows: T[],
  allIds: Set<string>,
  getId: (row: T) => string,
  enabled: boolean,
): { items: PresenceItem<T>[]; dropGhost: (id: string) => void } {
  const previous = useRef<{ rows: T[]; allIds: Set<string> } | null>(null);
  const [ghosts, setGhosts] = useState<{ row: T; id: string; index: number }[]>([]);
  const [entered, setEntered] = useState<Set<string>>(new Set());

  // Runs before paint so a removed row is never visible as a one-frame gap.
  useLayoutEffect(() => {
    const prev = previous.current;
    previous.current = { rows, allIds };
    if (!enabled || !prev || prev.allIds.size === 0 || prefersReducedMotion()) return;
    const present = new Set(rows.map(getId));
    const removed = prev.rows
      .map((row, index) => ({ row, id: getId(row), index }))
      .filter((item) => !allIds.has(item.id) && !present.has(item.id));
    const added = rows.map(getId).filter((id) => !prev.allIds.has(id));
    if (removed.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the ghost must exist before the browser paints the removal
      setGhosts((current) => [...current, ...removed]);
    }
    if (added.length > 0) setEntered((current) => new Set([...current, ...added]));
  }, [rows, allIds, getId, enabled]);

  const dropGhost = (id: string) => {
    setGhosts((current) => current.filter((ghost) => ghost.id !== id));
    setEntered((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const items: PresenceItem<T>[] = rows.map((row) => {
    const id = getId(row);
    return { row, id, entering: entered.has(id), exiting: false };
  });
  for (const ghost of [...ghosts].sort((a, b) => a.index - b.index)) {
    if (items.some((item) => item.id === ghost.id)) continue;
    items.splice(Math.min(ghost.index, items.length), 0, {
      row: ghost.row,
      id: ghost.id,
      entering: false,
      exiting: true,
    });
  }
  return { items, dropGhost };
}

/**
 * Crossfades a marker/action area when `stateKey` changes: the previous
 * content fades out in place while the new content fades in. Renders only the
 * current content the rest of the time.
 */
export function StateSwap({
  stateKey,
  children,
  className,
}: {
  stateKey: string;
  children: ReactNode;
  className?: string;
}) {
  const lastKey = useRef(stateKey);
  const lastChildren = useRef<ReactNode>(children);
  const [leaving, setLeaving] = useState<{ key: string; node: ReactNode } | null>(null);
  const [swapped, setSwapped] = useState(false);

  useLayoutEffect(() => {
    if (lastKey.current !== stateKey) {
      const previousNode = lastChildren.current;
      const previousKey = lastKey.current;
      lastKey.current = stateKey;
      if (!prefersReducedMotion()) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the old layer must be captured before the browser paints the swap
        setLeaving({ key: previousKey, node: previousNode });
        setSwapped(true);
      }
    }
    lastChildren.current = children;
  }, [stateKey, children]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), LIST_MOTION_MS + 60);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div className={cn("relative inline-grid", className)}>
      {leaving && (
        <div
          key={`leaving-${leaving.key}`}
          aria-hidden="true"
          inert
          className="list-swap-out pointer-events-none absolute inset-0 flex items-center justify-end"
        >
          {leaving.node}
        </div>
      )}
      <div
        key={stateKey}
        className={cn("flex items-center justify-end", swapped && "list-swap-in")}
      >
        {children}
      </div>
    </div>
  );
}
