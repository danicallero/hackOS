import { StatusDot } from "@/components/common/status-dot";
import type { Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/** A labelled state, with an optional semantic dot. */
export function StatusBadge({
  tone = "neutral",
  dot = true,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <StatusDot tone={tone} dot={dot} className={cn("whitespace-normal", className)}>
      {children}
    </StatusDot>
  );
}
