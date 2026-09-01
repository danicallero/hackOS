/**
 * Trigger-event catalogue (H8): the fixed, developer-defined vocabulary of
 * "things that can happen" that an admin-configured `role_grant_rules` row
 * may react to. Mirrors CAPABILITIES's own doc comment and rationale —
 * adding a new automatic-grant scenario here (and wiring exactly one
 * `applyRoleGrantRule` call at the domain event that should fire it,
 * apps/api/src/modules/identity/role-grants.ts) is the one place a developer
 * needs to touch; from then on an admin can freely configure which role(s)
 * that event grants/revokes — globally or scoped to one enterprise — with no
 * further code changes. Never construct a trigger-event string inline:
 * import it from here, same discipline as CAPABILITIES/EVENTS.
 */
export const TRIGGER_EVENTS = {
  /** A user gains their first (or another) enterprise affiliation (H43-H46). */
  SPONSOR_ENTERPRISE_LINKED: "sponsor.enterprise_linked",
  /** A user loses their last enterprise affiliation (H43-H46). */
  SPONSOR_ENTERPRISE_UNLINKED: "sponsor.enterprise_unlinked",
  /** A user is added to an enterprise's judge roster (H43-H46). */
  JUDGE_ENTERPRISE_ASSIGNED: "judge.enterprise_assigned",
  /** A user is removed from an enterprise's judge roster (H43-H46). */
  JUDGE_ENTERPRISE_REMOVED: "judge.enterprise_removed",
} as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[keyof typeof TRIGGER_EVENTS];

export const ALL_TRIGGER_EVENTS: readonly string[] = Object.values(TRIGGER_EVENTS);

export function isKnownTriggerEvent(value: string): value is TriggerEvent {
  return (ALL_TRIGGER_EVENTS as string[]).includes(value);
}
