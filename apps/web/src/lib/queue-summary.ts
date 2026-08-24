import type { Translate } from "@/lib/i18n";

export function queueSummaryValues(
  t: Translate,
  counts: { challenges: number; rooms: number; teams: number },
) {
  return {
    ...counts,
    challengesLabel: t("challengesSummaryLabel"),
    roomsLabel: t(counts.rooms === 1 ? "roomSummaryLabel" : "roomsLabel"),
    teamsLabel: t(counts.teams === 1 ? "teamLabel" : "teamsLabel"),
  };
}
