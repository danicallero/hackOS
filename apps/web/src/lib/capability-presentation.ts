import { ALL_CAPABILITIES, CAPABILITIES, type Capability } from "@hackos/shared/capabilities";
import type { MessageKey, Translate } from "@/lib/i18n";
import { normalizeSearchText } from "./search-text";

/**
 * Capability presentation helpers (H8). The catalogue is derived entirely from
 * `ALL_CAPABILITIES` (the single source in @hackos/shared) so the UI never
 * hardcodes a capability string of its own.
 */

/** Domain a capability belongs to — the part before ":". "*" is the admin wildcard. */
function capabilityDomain(cap: string): string {
  return cap === "*" ? "admin" : (cap.split(":")[0] ?? cap);
}

/** Human-ish label, e.g. "users:read" → "Users · Read", "*" → "All permissions". */
export function prettifyCapability(cap: string, t: Translate): string {
  if (cap === "*") return t("allPermissionsLabel");
  const [domain, action] = cap.split(":");
  const cap1 = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return action ? `${cap1(domain)} · ${cap1(action)}` : cap1(domain);
}

/**
 * Maps each catalogue capability to its `capabilityDescription*` message key
 * (H8). Descriptions themselves are single-sourced as English prose in
 * `CAPABILITY_DESCRIPTIONS` (`@hackos/shared/capabilities`); this file has no
 * i18n machinery, so the web UI keeps its own es/gl/en translations of the
 * same content under these keys (see `packages/shared/locales/*\/web.json`).
 */
const CAPABILITY_DESCRIPTION_KEYS: Record<Capability, MessageKey> = {
  [CAPABILITIES.HELPDESK_OFFER]: "capabilityDescriptionHelpdeskOffer",
  [CAPABILITIES.HELPDESK_REQUEST]: "capabilityDescriptionHelpdeskRequest",
  [CAPABILITIES.HELPDESK_COVERAGE]: "capabilityDescriptionHelpdeskCoverage",
  [CAPABILITIES.HELPDESK_MANAGE]: "capabilityDescriptionHelpdeskManage",
  [CAPABILITIES.ADMIN_ALL]: "capabilityDescriptionAdminAll",
  [CAPABILITIES.USERS_READ]: "capabilityDescriptionUsersRead",
  [CAPABILITIES.USERS_WRITE]: "capabilityDescriptionUsersWrite",
  [CAPABILITIES.PERMISSIONS_MANAGE]: "capabilityDescriptionPermissionsManage",
  [CAPABILITIES.INVITES_MANAGE]: "capabilityDescriptionInvitesManage",
  [CAPABILITIES.APPLICATIONS_MANAGE]: "capabilityDescriptionApplicationsManage",
  [CAPABILITIES.APPLICATIONS_REVIEW]: "capabilityDescriptionApplicationsReview",
  [CAPABILITIES.APPLICATIONS_DECIDE]: "capabilityDescriptionApplicationsDecide",
  [CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE]: "capabilityDescriptionApplicationsConfirmOverride",
  [CAPABILITIES.APPLICATIONS_EDIT_RESPONSE]: "capabilityDescriptionApplicationsEditResponse",
  [CAPABILITIES.STATISTICS_MANAGE]: "capabilityDescriptionStatisticsManage",
  [CAPABILITIES.PROJECTS_READ]: "capabilityDescriptionProjectsRead",
  [CAPABILITIES.PROJECTS_EDIT]: "capabilityDescriptionProjectsEdit",
  [CAPABILITIES.ACCREDIT_SCAN]: "capabilityDescriptionAccreditScan",
  [CAPABILITIES.PRESENCE_SCAN]: "capabilityDescriptionPresenceScan",
  [CAPABILITIES.ACTIVITY_SCAN]: "capabilityDescriptionActivityScan",
  [CAPABILITIES.LOGISTICS_STATS]: "capabilityDescriptionLogisticsStats",
  [CAPABILITIES.INTOLERANCES_MANAGE]: "capabilityDescriptionIntolerancesManage",
  [CAPABILITIES.MEAL_PLANS_EXPORT]: "capabilityDescriptionMealPlansExport",
  [CAPABILITIES.MEAL_PLANS_MANAGE]: "capabilityDescriptionMealPlansManage",
  [CAPABILITIES.QUEUE_STATUS]: "capabilityDescriptionQueueStatus",
  [CAPABILITIES.QUEUE_OPERATE]: "capabilityDescriptionQueueOperate",
  [CAPABILITIES.QUEUE_ADMIN]: "capabilityDescriptionQueueAdmin",
  [CAPABILITIES.JUDGE_PANEL]: "capabilityDescriptionJudgePanel",
  [CAPABILITIES.JUDGING_EXPORT]: "capabilityDescriptionJudgingExport",
  [CAPABILITIES.SPONSORS_MANAGE]: "capabilityDescriptionSponsorsManage",
  [CAPABILITIES.CHALLENGES_MANAGE]: "capabilityDescriptionChallengesManage",
  [CAPABILITIES.SCHEDULE_READ]: "capabilityDescriptionScheduleRead",
  [CAPABILITIES.SCHEDULE_MANAGE]: "capabilityDescriptionScheduleManage",
  [CAPABILITIES.ANNOUNCEMENTS_MANAGE]: "capabilityDescriptionAnnouncementsManage",
  [CAPABILITIES.TV_CONTROL]: "capabilityDescriptionTvControl",
  [CAPABILITIES.EVENT_MANAGE]: "capabilityDescriptionEventManage",
  [CAPABILITIES.VENUE_MANAGE]: "capabilityDescriptionVenueManage",
  [CAPABILITIES.WALLET_MANAGE]: "capabilityDescriptionWalletManage",
  [CAPABILITIES.PRESENCE_MANAGE]: "capabilityDescriptionPresenceManage",
  [CAPABILITIES.NOTIFICATIONS_SEND]: "capabilityDescriptionNotificationsSend",
  [CAPABILITIES.AUDIT_READ]: "capabilityDescriptionAuditRead",
  [CAPABILITIES.EXPORTS_RUN]: "capabilityDescriptionExportsRun",
};

/** Short inline description of what a capability grants, or "" if none is defined. */
export function capabilityDescription(cap: string, t: Translate): string {
  const key = (CAPABILITY_DESCRIPTION_KEYS as Partial<Record<string, MessageKey>>)[cap];
  return key ? t(key) : "";
}

/** All capabilities grouped by domain, preserving catalogue order. */
export function capabilitiesByDomain(): { domain: string; capabilities: string[] }[] {
  const groups: { domain: string; capabilities: string[] }[] = [];
  for (const cap of selectableCapabilities()) {
    const domain = capabilityDomain(cap);
    let group = groups.find((g) => g.domain === domain);
    if (!group) {
      group = { domain, capabilities: [] };
      groups.push(group);
    }
    group.capabilities.push(cap);
  }
  return groups;
}

/** All capabilities are current catalogue entries and may be assigned. */
export function selectableCapabilities(): string[] {
  return ALL_CAPABILITIES;
}

/**
 * The capability catalogue, grouped by domain, filtered to entries whose
 * code or prettified label matches `query` (case- and accent-insensitive). Empty groups
 * are dropped rather than shown with zero rows.
 */
export function filterCapabilitiesByDomain(
  query: string,
  t: Translate,
): { domain: string; capabilities: string[] }[] {
  const needle = normalizeSearchText(query);
  if (!needle) return capabilitiesByDomain();
  return capabilitiesByDomain()
    .map((group) => ({
      domain: group.domain,
      capabilities: group.capabilities.filter(
        (cap) =>
          normalizeSearchText(cap).includes(needle) ||
          normalizeSearchText(prettifyCapability(cap, t)).includes(needle),
      ),
    }))
    .filter((group) => group.capabilities.length > 0);
}
