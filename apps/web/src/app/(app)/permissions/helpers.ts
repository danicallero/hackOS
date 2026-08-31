import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import type { MultiSelectOption } from "@/components/common/multi-select";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { RoleTemplate, UserListItem } from "@/lib/types";

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
  "projects:read": "capabilityDescriptionProjectsRead",
  "projects:import": "capabilityDescriptionProjectsImport",
  "projects:edit": "capabilityDescriptionProjectsEdit",
  "accredit:scan": "capabilityDescriptionAccreditScan",
  "presence:scan": "capabilityDescriptionPresenceScan",
  "activity:scan": "capabilityDescriptionActivityScan",
  "logistics:stats": "capabilityDescriptionLogisticsStats",
  "intolerances:manage": "capabilityDescriptionIntolerancesManage",
  "queue:operate": "capabilityDescriptionQueueOperate",
  "queue:admin": "capabilityDescriptionQueueAdmin",
  "judge:panel": "capabilityDescriptionJudgePanel",
  "judging:export": "capabilityDescriptionJudgingExport",
  "sponsors:manage": "capabilityDescriptionSponsorsManage",
  "challenges:manage": "capabilityDescriptionChallengesManage",
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

/** Options for the capabilities MultiSelect: raw string value + prettified label. */
export function capabilityOptions(t: Translate): MultiSelectOption[] {
  return selectableCapabilities().map((cap) => ({
    value: cap,
    label: cap,
    description: prettifyCapability(cap, t),
  }));
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

/** Deprecated compatibility capability: never offer it for a new assignment (AC-3T2). */
export function selectableCapabilities(): string[] {
  return ALL_CAPABILITIES.filter((cap) => cap !== "sponsor:portal");
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

const TEMPLATE_COPY_KEYS: Record<string, { name: MessageKey; description: MessageKey }> = {
  platformadministrator: {
    name: "permissionTemplatePlatformAdministrator",
    description: "permissionTemplatePlatformAdministratorDescription",
  },
  accessadministrator: {
    name: "permissionTemplateAccessAdministrator",
    description: "permissionTemplateAccessAdministratorDescription",
  },
  applicationbuilder: {
    name: "permissionTemplateApplicationBuilder",
    description: "permissionTemplateApplicationBuilderDescription",
  },
  applicationreviewer: {
    name: "permissionTemplateApplicationReviewer",
    description: "permissionTemplateApplicationReviewerDescription",
  },
  applicationdecisions: {
    name: "permissionTemplateApplicationDecisions",
    description: "permissionTemplateApplicationDecisionsDescription",
  },
  applicationsupervisor: {
    name: "permissionTemplateApplicationSupervisor",
    description: "permissionTemplateApplicationSupervisorDescription",
  },
  projectoperator: {
    name: "permissionTemplateProjectOperator",
    description: "permissionTemplateProjectOperatorDescription",
  },
  queueoperator: {
    name: "permissionTemplateQueueOperator",
    description: "permissionTemplateQueueOperatorDescription",
  },
  judgingadministrator: {
    name: "permissionTemplateJudgingAdministrator",
    description: "permissionTemplateJudgingAdministratorDescription",
  },
  accreditationstation: {
    name: "permissionTemplateAccreditationStation",
    description: "permissionTemplateAccreditationStationDescription",
  },
  presencestation: {
    name: "permissionTemplatePresenceStation",
    description: "permissionTemplatePresenceStationDescription",
  },
  activityandmealstation: {
    name: "permissionTemplateActivityAndMealStation",
    description: "permissionTemplateActivityAndMealStationDescription",
  },
  logisticssupervisor: {
    name: "permissionTemplateLogisticsSupervisor",
    description: "permissionTemplateLogisticsSupervisorDescription",
  },
  programmemanager: {
    name: "permissionTemplateProgrammeManager",
    description: "permissionTemplateProgrammeManagerDescription",
  },
  tvoperator: {
    name: "permissionTemplateTvOperator",
    description: "permissionTemplateTvOperatorDescription",
  },
  sponsoradministrator: {
    name: "permissionTemplateSponsorAdministrator",
    description: "permissionTemplateSponsorAdministratorDescription",
  },
  communicationsmanager: {
    name: "permissionTemplateCommunicationsManager",
    description: "permissionTemplateCommunicationsManagerDescription",
  },
  dataauditor: {
    name: "permissionTemplateDataAuditor",
    description: "permissionTemplateDataAuditorDescription",
  },
  contentlibrarymanager: {
    name: "permissionTemplateContentLibraryManager",
    description: "permissionTemplateContentLibraryManagerDescription",
  },
};

/**
 * UI labels are deliberately local rather than API-provided strings. Backend keys may use
 * dashes, underscores, or colons; normalizing keeps the API contract key-only.
 */
function templateCopyKeys(templateKey: string) {
  return TEMPLATE_COPY_KEYS[templateKey.replaceAll(/[^a-z]/gi, "").toLowerCase()] ?? null;
}

type TemplateCopy = Pick<RoleTemplate, "labelKey" | "descriptionKey">;

export function permissionTemplateName(template: TemplateCopy | string, t: Translate): string {
  if (typeof template !== "string") return t(template.labelKey);
  const keys = templateCopyKeys(template);
  return keys ? t(keys.name) : t("permissionTemplate");
}

export function permissionTemplateDescription(
  template: TemplateCopy | string,
  t: Translate,
): string {
  if (typeof template !== "string") return t(template.descriptionKey);
  const keys = templateCopyKeys(template);
  return keys ? t(keys.description) : t("permissionTemplateDescription");
}

/** The API only permits an existing wildcard holder to create/reset this template. */
export function templateRequiresWildcardAuthority(template: Pick<RoleTemplate, "capabilities">) {
  return template.capabilities.includes("*");
}

/** Display name for a user directory entry, falling back to email / "User #id". */
export function userDisplayName(
  user: Pick<UserListItem, "id" | "name" | "surname" | "email">,
  t: Translate,
): string {
  const full = [user.name, user.surname].filter(Boolean).join(" ").trim();
  return full || user.email || t("userNumberFallback", { id: user.id });
}
