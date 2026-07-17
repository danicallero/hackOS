import type { PublicEvent } from "@/components/public/public-types";
import type { I18nText } from "@/lib/i18n";

export const DATA_PHASES = ["before", "during", "after"] as const;
export type DataPhase = (typeof DATA_PHASES)[number];

export const FRESHNESS_KINDS = ["actual", "estimated", "provisional", "incomplete"] as const;
export type FreshnessKind = (typeof FRESHNESS_KINDS)[number];

/**
 * Select the operational dashboard without hiding the other phases. The event
 * configuration remains the source of truth; this does not invent a second
 * event lifecycle or change any statistical formula.
 */
export function defaultDataPhase(event: PublicEvent | null, now = Date.now()): DataPhase {
  if (!event) return "before";
  const startsAt = event.hackingStartsAt ? Date.parse(event.hackingStartsAt) : null;
  const endsAt = event.judgingEndsAt
    ? Date.parse(event.judgingEndsAt)
    : event.hackingEndsAt
      ? Date.parse(event.hackingEndsAt)
      : null;

  if (startsAt !== null && now < startsAt) return "before";
  if (endsAt !== null && now >= endsAt) return "after";
  return startsAt !== null || endsAt !== null ? "during" : "before";
}

/** Use one normalized query for both the visible dataset and its export. */
export function normalizedFilters(
  filters: Record<string, string | number | null | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filters)
      .filter(
        (entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined,
      )
      .map(([key, value]) => [key, String(value)])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function exportUrl(
  path: string,
  filters: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams(normalizedFilters(filters));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export interface ApplicationStats {
  application: { id: number; name: string; type: string; capacity: number | null };
  counts_by_status: Record<string, number>;
  funnel: {
    sent: number;
    still_in_window: number;
    expired: number;
    declined: number;
    confirmed: number;
  };
  time_series: {
    submissions_by_day: Array<{ bucket: string; n: number }>;
    confirmations_by_day: Array<{ bucket: string; n: number }>;
    submissions_by_hour_of_day: Array<{ hour: number; n: number }>;
    submissions_by_day_of_week: Array<{ dow: number; n: number }>;
  };
  time_to_confirm_hours: { avg: number | null; median: number | null };
  shirt_sizes_confirmed: Array<{ value: string; n: number }>;
  food_intolerances_confirmed: Array<{
    intolerance_id: number;
    label: I18nText;
    n: number;
  }>;
}
