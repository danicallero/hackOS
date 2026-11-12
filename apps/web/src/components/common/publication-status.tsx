"use client";

import { StatusBadge } from "@/components/common/status-badge";
import { isScheduled, type Visibility, visibilityTone } from "@/lib/challenges";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";

/**
 * Visible / hidden badge. With `availableFrom`, a hidden item whose reveal is
 * still ahead reads "scheduled" instead of "hidden" (H45, H48).
 */
export function VisibilityBadge({
  visibility,
  availableFrom,
}: {
  visibility: Visibility;
  availableFrom?: string | null;
}) {
  const { t } = useLocale();
  if (visibility === "hidden" && isScheduled(availableFrom ?? null)) {
    return <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>;
  }
  return (
    <StatusBadge tone={visibilityTone(visibility)}>
      {visibility === "visible" ? t("visibleLabel") : t("hiddenOption")}
    </StatusBadge>
  );
}

/** "Reveal" table cell: the scheduled date, "immediate" for a visible item, or a dash. */
export function RevealCell({
  visibility,
  availableFrom,
}: {
  visibility: Visibility;
  availableFrom: string | null;
}) {
  const { t, language } = useLocale();
  if (visibility === "hidden" && availableFrom && isScheduled(availableFrom)) {
    return (
      <div className="flex items-center gap-2">
        <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>
        <span className="text-muted-foreground text-sm">
          {formatEventDate(availableFrom, language, "dateTime")}
        </span>
      </div>
    );
  }
  if (visibility === "visible") {
    return (
      <span className="text-muted-foreground text-sm">
        {availableFrom ? formatEventDate(availableFrom, language, "dateTime") : t("immediate")}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
