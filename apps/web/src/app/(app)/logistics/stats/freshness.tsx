"use client";

import { StatusBadge } from "@/components/common/status-badge";
import { useLocale } from "@/lib/i18n";
import { FRESHNESS_LABEL_KEYS, type FreshnessKind } from "./model";

/** UI component for freshness indicator badge (actual/estimated/provisional/incomplete). */
export function Freshness({ kind }: { kind: FreshnessKind }) {
  const { t } = useLocale();
  const tone =
    kind === "actual"
      ? "success"
      : kind === "estimated"
        ? "info"
        : kind === "incomplete"
          ? "danger"
          : "warning";
  return (
    <StatusBadge tone={tone} dot={false}>
      {t(FRESHNESS_LABEL_KEYS[kind])}
    </StatusBadge>
  );
}
