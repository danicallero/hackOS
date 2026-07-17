import { AlertCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Persistent error feedback for the region whose operation failed. */
export function ContextualError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <div
      role="alert"
      className={cn(
        "border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-3 rounded-md border p-4",
        className,
      )}
    >
      <AlertCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-3">
        <p className="text-pretty text-sm">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </div>
    </div>
  );
}
