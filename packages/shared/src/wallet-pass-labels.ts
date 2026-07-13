/**
 * Customizable caption text shown on the Apple Wallet pass (H28) — e.g.
 * "Participant", "Role", "University". Organizers override these from the
 * event settings page instead of a developer editing wallet.ts; add new
 * customizable captions HERE, never as inline string literals in wallet.ts
 * or the settings page.
 */
export const PASS_FIELD_LABEL_KEYS = [
  "participant",
  "role",
  "passType",
  "ticketValue",
  "badgeValue",
  "university",
  "email",
  "event",
  "location",
  "organizedBy",
] as const;

export type PassFieldLabelKey = (typeof PASS_FIELD_LABEL_KEYS)[number];

export const DEFAULT_PASS_FIELD_LABELS: Record<PassFieldLabelKey, string> = {
  participant: "Participant",
  role: "Role",
  passType: "Pass",
  ticketValue: "Ticket",
  badgeValue: "Badge",
  university: "University",
  email: "Email",
  event: "Event",
  location: "Location",
  organizedBy: "Organized by",
};

export type PassFieldLabels = Partial<Record<PassFieldLabelKey, string>>;

/** Blank/whitespace overrides fall back to the default — same "clear the field to reset" convention as the rest of event_config. */
export function resolvePassFieldLabels(
  overrides: PassFieldLabels | null | undefined,
): Record<PassFieldLabelKey, string> {
  const resolved = { ...DEFAULT_PASS_FIELD_LABELS };
  for (const key of PASS_FIELD_LABEL_KEYS) {
    const value = overrides?.[key];
    if (value?.trim()) resolved[key] = value.trim();
  }
  return resolved;
}
