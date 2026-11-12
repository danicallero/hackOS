import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** Persistent error feedback for the region whose operation failed. */
export function ContextualError({
  message,
  onRetry,
  className,
}: {
  /** User-facing failure description, already localized. */
  message: string;
  /** Shows a Retry button when provided; omit for non-retriable failures. */
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useLocale();

  return (
    <Alert variant="destructive" className={className}>
      <WarningCircleIcon aria-hidden="true" />
      <AlertDescription className="min-w-0 gap-3">
        <p className="text-pretty">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
