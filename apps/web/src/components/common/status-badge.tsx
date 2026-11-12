import { StatusDot } from "@/components/common/status-dot";
import type { Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/** A labelled state with its semantic marker: a dot, or `icon` in its place. */
export function StatusBadge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <StatusDot tone={tone} icon={icon} className={cn("whitespace-normal", className)}>
      {children}
    </StatusDot>
  );
}
