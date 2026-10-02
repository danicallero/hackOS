import { SpinnerGapIcon } from "@phosphor-icons/react/dist/ssr/SpinnerGap";
import { cn } from "@/lib/utils";

/** Consistent Phosphor loading spinner with the shared size and spin animation. */
export function Spinner({ className }: { className?: string }) {
  return <SpinnerGapIcon className={cn("size-4 animate-spin", className)} aria-hidden />;
}
