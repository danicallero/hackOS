"use client";

import { useMemo } from "react";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import type { LogisticsStats } from "@/lib/logistics";
import { hourlyFlowRows } from "./event-series";
import type { StatsChartDatum } from "./stats-chart";

/** H27: chart datasets shared by the during (operations) and after (results) phases. */
export function useEventChartRows(stats: LogisticsStats | null): {
  hourly: StatsChartDatum[];
  roles: StatsChartDatum[];
  meals: StatsChartDatum[];
  activities: StatsChartDatum[];
} {
  const { language, t } = useLocale();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE_CODES[language], {
      day: "numeric",
      month: "short",
      hour: "2-digit",
    });
    return {
      hourly: hourlyFlowRows(
        stats?.hourly,
        {
          accreditations: t("accredited"),
          meals: t("mealsServed"),
          activities: t("activityScans"),
        },
        (bucket) => format.format(new Date(bucket)),
      ),
      roles: (stats?.accreditedByRole ?? []).map((row) => ({
        label: row.role ?? t("unknownPerson"),
        n: row.count,
      })),
      meals: (stats?.meals ?? []).map((row) => ({ label: row.name, n: row.served })),
      activities: (stats?.activities ?? []).map((row) => ({ label: row.name, n: row.attendees })),
    };
  }, [language, stats, t]);
}
