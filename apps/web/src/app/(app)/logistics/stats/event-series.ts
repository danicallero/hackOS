import type { HourlyBucket, LogisticsStats, PresenceHours } from "@/lib/logistics";
import type { StatsChartDatum } from "./stats-chart";

/**
 * H27: one row per (hour, series) over the union of hours, zero-filled, so
 * every series draws a continuous line over the same time axis.
 */
export function hourlyFlowRows(
  hourly: LogisticsStats["hourly"] | undefined,
  seriesLabels: { accreditations: string; meals: string; activities: string },
  formatBucket: (bucketIso: string) => string,
): StatsChartDatum[] {
  if (!hourly) return [];
  const series = [
    { name: seriesLabels.accreditations, buckets: hourly.accreditations },
    { name: seriesLabels.meals, buckets: hourly.meals },
    { name: seriesLabels.activities, buckets: hourly.activities },
  ];
  const hours = [...new Set(series.flatMap((entry) => entry.buckets.map((row) => row.bucket)))]
    .map((bucket) => ({ bucket, time: Date.parse(bucket) }))
    .sort((left, right) => left.time - right.time);
  const rows: StatsChartDatum[] = [];
  for (const entry of series) {
    if (entry.buckets.length === 0) continue;
    const byBucket = new Map<string, HourlyBucket>(entry.buckets.map((row) => [row.bucket, row]));
    for (const hour of hours) {
      rows.push({
        label: formatBucket(hour.bucket),
        n: byBucket.get(hour.bucket)?.n ?? 0,
        series: entry.name,
      });
    }
  }
  return rows;
}

const HOUR_BANDS: Array<{ label: string; max: number }> = [
  { label: "<2 h", max: 2 },
  { label: "2–6 h", max: 6 },
  { label: "6–12 h", max: 12 },
  { label: "12–24 h", max: 24 },
  { label: "24+ h", max: Number.POSITIVE_INFINITY },
];

/** Participants grouped by hours present; people with no presence are excluded. */
export function hoursDistributionRows(hours: PresenceHours[]): StatsChartDatum[] {
  const counts = HOUR_BANDS.map(() => 0);
  for (const row of hours) {
    if (row.hours <= 0) continue;
    const band = HOUR_BANDS.findIndex((candidate) => row.hours < candidate.max);
    counts[band] += 1;
  }
  return HOUR_BANDS.map((band, index) => ({ label: band.label, n: counts[index] }));
}

export function hoursSummary(hours: PresenceHours[]) {
  const attended = hours.filter((row) => row.hours > 0);
  const total = attended.reduce((sum, row) => sum + row.hours, 0);
  return {
    attended: attended.length,
    totalHours: total,
    averageHours: attended.length === 0 ? null : total / attended.length,
  };
}
