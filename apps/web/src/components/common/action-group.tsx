import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared action layout. Keep adjacent actions on the same 8px rhythm and let
 * them wrap as a group when translations or narrow viewports need more room
 * (H8, H55).
 */
export function ActionGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="action-group"
      className={cn("flex flex-wrap items-center gap-(--space-related)", className)}
      {...props}
    />
  );
}
