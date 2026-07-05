import { cn } from "@/lib/utils";

/**
 * hackOS wordmark. Single source for the brand lockup — reuse it in the auth
 * shell, the sidebar header and anywhere the product name appears, so the mark
 * never drifts between screens.
 */
export function Brand({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", className)}>
      <span className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-sm font-bold">
        h
      </span>
      {showText && <span className="text-base tracking-tight">hackOS</span>}
    </span>
  );
}
