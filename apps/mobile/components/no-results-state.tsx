import { ActionButton, EmptyState } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";

/**
 * A list whose search or filters hid every record. It is not the empty
 * dataset: it offers the way back (clear the filters) when there is one.
 */
export function NoResultsState({ onClear }: { onClear?: () => void }) {
  const { t } = useLocale();
  return (
    <EmptyState
      icon="magnifyingglass"
      title={t("scannerNoResults")}
      action={onClear ? <ActionButton label={t("scheduleFilterClear")} onPress={onClear} /> : null}
    />
  );
}
