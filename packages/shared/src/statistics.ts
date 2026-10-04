export const STATISTICS_PARTICIPANT_STATUSES = [
  "accepted_internal",
  "accepted",
  "confirmed",
] as const;

export type StatisticsParticipantStatus = (typeof STATISTICS_PARTICIPANT_STATUSES)[number];
