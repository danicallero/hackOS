"use client";

import { UsersIcon } from "lucide-react";
import { StatCard } from "@/components/common/stat-card";
import { useLocale } from "@/lib/i18n";
import type { ApplicationStats } from "../lib";

// ── Stats strip (H27, logistics:stats) ────────────────────────────────────────

export function StatsStrip({ stats }: { stats: ApplicationStats }) {
  const { t } = useLocale();
  const c = stats.counts_by_status;
  const nonDraft = Object.entries(c)
    .filter(([s]) => s !== "draft")
    .reduce((a, [, v]) => a + v, 0);
  const accepted = (c.accepted_internal ?? 0) + (c.accepted ?? 0);
  const acceptedUnsent = c.accepted_internal ?? 0;
  const acceptedSent = c.accepted ?? 0;
  const declined =
    (c.rejected_internal ?? 0) + (c.rejected ?? 0) + (c.declined ?? 0) + (c.expired ?? 0);
  const declinedUnsent = c.rejected_internal ?? 0;
  const declinedSent = c.rejected ?? 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label={t("responsesLabel")}
        value={String(nonDraft)}
        icon={UsersIcon}
        hint={t("nonDraftHint")}
      />
      <StatCard
        label={t("acceptedLabel")}
        value={String(accepted)}
        hint={t("unsentSentHint", { unsent: acceptedUnsent, sent: acceptedSent })}
      />
      <StatCard label={t("confirmed")} value={String(c.confirmed ?? 0)} />
      <StatCard
        label={t("declined")}
        value={String(declined)}
        hint={t("declinedHint", {
          unsent: declinedUnsent,
          sent: declinedSent,
          declined: c.declined ?? 0,
          expired: c.expired ?? 0,
        })}
      />
    </div>
  );
}
