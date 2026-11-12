import { TONE_DOT, TONE_ICON, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";

/**
 * Quiet state marker: a tone marker beside its label, no pill. The marker is a
 * dot, or `icon` when a glyph names the state better. A state never renders as
 * a bare label: without its marker it reads as stray text.
 */
export function StatusDot({
  tone,
  children,
  className,
  icon,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  /** Replaces the dot; takes the tone's colour unless it sets its own. */
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "type-label text-foreground inline-flex items-center gap-1.5 whitespace-nowrap",
        className,
      )}
    >
      {icon ? (
        <span className={cn("inline-flex shrink-0 [&>svg]:size-3.5", TONE_ICON[tone])}>{icon}</span>
      ) : (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      )}
      {children}
    </span>
  );
}
