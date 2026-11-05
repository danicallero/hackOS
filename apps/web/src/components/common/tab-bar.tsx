"use client";

import { useCallback, useEffect, useRef } from "react";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * One segmented tab style; only its occupied width changes. On a narrow
 * viewport the line scrolls, and the selected tab (including one chosen by a
 * deep link or arrow keys) is brought into view along that line only.
 */
export function TabBar({
  width = "full",
  className,
  ref,
  ...props
}: React.ComponentProps<typeof TabsList> & {
  width?: "full" | "content";
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const reveal = () => {
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active || list.scrollWidth <= list.clientWidth) return;
      const left = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2;
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      list.scrollTo({ left: Math.max(0, left), behavior });
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(list, { attributes: true, attributeFilter: ["data-state"], subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <TabsList
      ref={setRef}
      data-width={width}
      className={cn(
        "max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none [&::-webkit-scrollbar]:hidden",
        width === "full" ? "w-full" : "w-fit [&_[data-slot=tabs-trigger]]:flex-none",
        className,
      )}
      {...props}
    />
  );
}
