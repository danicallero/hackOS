import { TONE_BADGE, TONE_DOT, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * Status pill used everywhere a state is shown (queue stages, container state,
 * application status…). One component; the meaning-to-color mapping is a prop
 * (`tone`) so it stays consistent app-wide. Optional leading dot.
 */
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
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}
