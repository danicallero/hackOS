import { XIcon } from "@phosphor-icons/react/dist/ssr/X";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";

/** Turn an unknown thrown value into a message, preferring ApiError copy. */
export function errorMessage(err: unknown, t: Translate, fallback: string): string {
  return apiErrorText(err, t, fallback);
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
    <Alert variant="destructive" aria-live="assertive" aria-atomic="true">
      <XIcon aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
