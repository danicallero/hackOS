"use client";

import { StatusBadge } from "@/components/common/status-badge";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import { type Enterprise, visibilityTone } from "../shared";

/** Read-only publication state for sponsor reps, who cannot edit it (H43, #928). */
export function PublicationSummary({
  enterprise,
}: {
  enterprise: Pick<Enterprise, "visibility" | "available_from">;
}) {
  const { language, t } = useLocale();
  const revealAt = enterprise.available_from ? new Date(enterprise.available_from) : null;
  return (
    <dl className="grid gap-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-muted-foreground">{t("colVisibility")}</dt>
        <dd className="mt-1">
          <StatusBadge tone={visibilityTone(enterprise.visibility)}>
            {enterprise.visibility === "visible" ? t("visibleLabel") : t("hiddenOption")}
          </StatusBadge>
        </dd>
      </div>
      {enterprise.visibility === "hidden" && revealAt && !Number.isNaN(revealAt.getTime()) && (
        <div>
          <dt className="text-muted-foreground">{t("publishAtLabel")}</dt>
          <dd className="mt-1">
            {new Intl.DateTimeFormat(LOCALE_CODES[language], {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(revealAt)}
          </dd>
        </div>
      )}
    </dl>
  );
}
