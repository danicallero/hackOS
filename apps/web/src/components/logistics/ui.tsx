import { XIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

/** Turn an unknown thrown value into a message, preferring ApiError copy. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * Labelled form field wrapper used across the logistics stations.
 *
 * The label block keeps a stable height so a field with a subtitle/hint does
 * not move its control relative to a neighbouring field (H22-H26).
 */
export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex min-h-[var(--control-height-default)] flex-col justify-start">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-muted-foreground text-xs text-pretty">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Inline error banner shown under a scanner/form action. */
export function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="border-destructive/40 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <XIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
