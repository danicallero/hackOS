"use client";

import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** One segmented tab style; only its occupied width changes. */
export function TabBar({
  width = "full",
  className,
  ...props
}: React.ComponentProps<typeof TabsList> & {
  width?: "full" | "content";
}) {
  return (
    <TabsList
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
