"use client";

import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The project's horizontal `TabsList` — scrolls itself when triggers outgrow
 * the container instead of clipping the last tab. Use this everywhere rather
 * than hand-rolling `overflow-x-auto` per page; behavior would drift.
 *
 * `overflow-y-hidden` is required alongside `overflow-x-auto`: per spec,
 * `visible` on one axis computes to `auto` when the other isn't `visible`,
 * so without it the list is invisibly scrollable vertically too — which
 * Safari then rubber-bands on touch/trackpad scroll.
 */
export function TabBar({ className, ...props }: React.ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain scrollbar-none [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}
