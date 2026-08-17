import { ALL_CAPABILITIES } from "@hackos/shared/capabilities";
import type { MultiSelectOption } from "@/components/common/multi-select";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { PermissionGroupTemplate, UserListItem } from "@/lib/types";

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

type TemplateCopy = Pick<PermissionGroupTemplate, "labelKey" | "descriptionKey">;

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
export function templateRequiresWildcardAuthority(
  template: Pick<PermissionGroupTemplate, "capabilities">,
) {
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
