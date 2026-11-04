import { TONE_DOT, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/** Quiet state marker for dense views: the tone as a dot beside its label, no pill. */
export function StatusDot({
  tone,
  children,
  className,
  dot = true,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "type-label text-foreground inline-flex items-center gap-1.5 whitespace-nowrap",
        className,
      )}
    >
      {dot && (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      )}
      {children}
    </span>
  );
}
