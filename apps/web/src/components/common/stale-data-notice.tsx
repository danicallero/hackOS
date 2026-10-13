import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** Non-blocking marker that the data shown is older than the last failed refresh. */
export function StaleDataNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <div role="status" className="text-warning flex items-center gap-2 px-1 text-sm">
      <WarningIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-pretty">{t("staleDataNotice")}</span>
      <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
