import { TONE_DOT, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * Labeled progress meter (used / limit), as in the monitoring cards. `value`
 * and `max` drive the fill; `tone` its color. Optional label + formatted
 * caption on top.
 */
export function UsageMeter({
  value,
  max = 100,
  tone = "brand",
  label,
  caption,
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label?: string;
  caption?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || caption) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          {caption && <span className="font-medium tabular-nums">{caption}</span>}
        </div>
      )}
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-[width]", TONE_DOT[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
