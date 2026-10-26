import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import type { MessageKey, Translate } from "@/lib/i18n";

/**
 * Capability presentation helpers (H8). The catalogue is derived entirely from
 * `ALL_CAPABILITIES` (the single source in @hackos/shared) so the UI never
 * hardcodes a capability string of its own.
 */

/** Domain a capability belongs to — the part before ":". "*" is the admin wildcard. */
export function capabilityDomain(cap: string): string {
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
const CAPABILITY_DESCRIPTION_KEYS: Partial<Record<string, MessageKey>> = {
  "*": "capabilityDescriptionAdminAll",
  "users:read": "capabilityDescriptionUsersRead",
  "users:write": "capabilityDescriptionUsersWrite",
  "permissions:manage": "capabilityDescriptionPermissionsManage",
  "invites:manage": "capabilityDescriptionInvitesManage",
  "applications:manage": "capabilityDescriptionApplicationsManage",
  "applications:review": "capabilityDescriptionApplicationsReview",
  "applications:decide": "capabilityDescriptionApplicationsDecide",
  "applications:confirm-override": "capabilityDescriptionApplicationsConfirmOverride",
  "applications:edit-response": "capabilityDescriptionApplicationsEditResponse",
  "statistics:manage": "capabilityDescriptionStatisticsManage",
  "projects:read": "capabilityDescriptionProjectsRead",
  "projects:edit": "capabilityDescriptionProjectsEdit",
  "accredit:scan": "capabilityDescriptionAccreditScan",
  "presence:scan": "capabilityDescriptionPresenceScan",
  "activity:scan": "capabilityDescriptionActivityScan",
  "logistics:stats": "capabilityDescriptionLogisticsStats",
  "intolerances:manage": "capabilityDescriptionIntolerancesManage",
  "meal-plans:export": "capabilityDescriptionMealPlansExport",
  "meal-plans:manage": "capabilityDescriptionMealPlansManage",
  "queue:status": "capabilityDescriptionQueueStatus",
  "queue:operate": "capabilityDescriptionQueueOperate",
  "queue:admin": "capabilityDescriptionQueueAdmin",
  "judge:panel": "capabilityDescriptionJudgePanel",
  "judging:export": "capabilityDescriptionJudgingExport",
  "sponsors:manage": "capabilityDescriptionSponsorsManage",
  "challenges:manage": "capabilityDescriptionChallengesManage",
  "schedule:read": "capabilityDescriptionScheduleRead",
  "schedule:manage": "capabilityDescriptionScheduleManage",
  "announcements:manage": "capabilityDescriptionAnnouncementsManage",
  "tv:control": "capabilityDescriptionTvControl",
  "event:manage": "capabilityDescriptionEventManage",
  "venue:manage": "capabilityDescriptionVenueManage",
  "wallet:manage": "capabilityDescriptionWalletManage",
  "presence:manage": "capabilityDescriptionPresenceManage",
  "notifications:send": "capabilityDescriptionNotificationsSend",
  "audit:read": "capabilityDescriptionAuditRead",
  "exports:run": "capabilityDescriptionExportsRun",
};

/** Short inline description of what a capability grants, or "" if none is defined. */
export function capabilityDescription(cap: string, t: Translate): string {
  const key = CAPABILITY_DESCRIPTION_KEYS[cap];
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
 * code or prettified label matches `query` (case-insensitive). Empty groups
 * are dropped rather than shown with zero rows.
 */
export function filterCapabilitiesByDomain(
  query: string,
  t: Translate,
): { domain: string; capabilities: string[] }[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return capabilitiesByDomain();
  return capabilitiesByDomain()
    .map((group) => ({
      domain: group.domain,
      capabilities: group.capabilities.filter(
        (cap) =>
          cap.toLowerCase().includes(needle) ||
          prettifyCapability(cap, t).toLowerCase().includes(needle),
      ),
    }))
    .filter((group) => group.capabilities.length > 0);
}
