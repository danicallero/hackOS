"use client";

import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * The project's horizontal `TabsList`: identical to the primitive, but it
 * scrolls itself when the triggers outgrow the container instead of letting
 * the last tab be silently cut off at the edge. Its own scrollbar is hidden so
 * it can't sit inside the 36px pill, and `max-w-full` keeps a `w-full` list
 * from pushing the page wider than its container. `overflow-y-hidden` is
 * required alongside `overflow-x-auto`: per spec, a `visible` value on one
 * axis computes to `auto` when the other axis isn't `visible`, so without it
 * the list is (invisibly) vertically scrollable too — which Safari then
 * rubber-bands on touch/trackpad scroll.
 *
 * Use this for every horizontal tab bar — a page that hand-rolls its own
 * `overflow-x-auto` wrapper (or `flex-wrap`, which the fixed pill height clips)
 * ends up with a different overflow behaviour on each screen.
 */
export function TabBar({ className, ...props }: React.ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  );
}
