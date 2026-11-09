import type { HelpdeskSchedule } from "@hackos/shared/help-desk";
import { useEffect } from "react";
import { shortMoment } from "@/lib/help-desk";
import type { MessageKey } from "@/lib/i18n";
import { useHelpResource } from "@/lib/use-help-resource";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * H64: whether the help desk accepts new requests. Only an explicit `open: false`
 * closes (an unread schedule never blocks), and the read repeats when the next
 * opening or closing passes so the entry points follow the clock.
 */
export function useHelpSchedule(enabled = true) {
  const resource = useHelpResource<HelpdeskSchedule>(enabled ? "/api/helpdesk/schedule" : null);
  const { load } = resource;
  const next = resource.data?.nextChangeAt ?? null;
  useEffect(() => {
    if (!next) return;
    const delay = Math.min(Math.max(Date.parse(next) - Date.now(), 0) + 1000, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => void load(), delay);
    return () => clearTimeout(timer);
  }, [next, load]);
  return { closed: resource.data?.open === false, schedule: resource.data };
}

/** The one-line closed message, with the reopening moment when there is one. */
export function helpClosedText(
  schedule: HelpdeskSchedule | null,
  language: string,
  t: (key: MessageKey, vars?: Record<string, string>) => string,
): string {
  return schedule?.nextChangeAt
    ? t("helpClosedOpens", { date: shortMoment(schedule.nextChangeAt, language) })
    : t("helpClosed");
}
