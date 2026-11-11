"use client";
import type { HelpdeskSchedule } from "@hackos/shared/help-desk";
import { formatEventDate } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";

/** H64: the one-line reason a new request cannot be sent, with the reopening moment when known. */
export function HelpdeskClosedNotice({
  schedule,
  id,
}: {
  schedule: HelpdeskSchedule | null;
  id?: string;
}) {
  const { t, language } = useLocale();
  if (schedule?.open !== false) return null;
  return (
    <p id={id} className="text-muted-foreground text-sm text-pretty">
      {schedule.nextChangeAt
        ? t("helpDeskClosedOpens", {
            date: formatEventDate(schedule.nextChangeAt, language, "dateTime"),
          })
        : t("helpDeskClosed")}
    </p>
  );
}
