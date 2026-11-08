import type { StatsChartDatum } from "./stats-chart";

// H27: daily API buckets stay unchanged; only the time-series presentation accumulates.
export function cumulativeDailyRows(
  rows: Array<{ bucket: string; n: number }>,
  label: (bucket: string) => string,
): StatsChartDatum[] {
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + row.n);
  const days = [...counts.keys()].sort((left, right) => left.localeCompare(right));
  const end = Date.parse(`${days[days.length - 1]}T00:00:00Z`);
  const result: StatsChartDatum[] = [];
  let total = 0;
  for (let day = Date.parse(`${days[0]}T00:00:00Z`); day <= end; day += 86_400_000) {
    const bucket = new Date(day).toISOString().slice(0, 10);
    const daily = counts.get(bucket) ?? 0;
    total += daily;
    result.push({ label: label(bucket), n: total, daily });
  }
  return result;
}
