import { TONE_DOT, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/** Quiet state marker for dense views: the tone as a dot beside its label, no pill. */
export function StatusDot({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}
