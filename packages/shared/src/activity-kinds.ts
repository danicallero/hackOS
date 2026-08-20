/** Built-in schedule kinds offered by the activity editor and reminder preferences. */
export const ACTIVITY_KINDS = [
  "activity",
  "meal",
  "workshop",
  "talk",
  "ceremony",
  "deadline",
  "other",
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
