import { ALL_TRIGGER_EVENTS, TRIGGER_EVENTS } from "@hackos/shared/role-grant-triggers";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { RoleGrantRule, RoleTemplate, UserListItem } from "@/lib/types";

export { ALL_TRIGGER_EVENTS };

/**
 * Human label for a trigger_event constant (H8). The registry itself
 * (packages/shared/src/role-grant-triggers.ts) is the single source of the
 * event strings; this maps each one to its own translated label, the same
 * pattern prettifyCapability uses for the capability catalogue below.
 */
const TRIGGER_EVENT_LABEL_KEYS: Record<string, MessageKey> = {
  [TRIGGER_EVENTS.SPONSOR_ENTERPRISE_LINKED]: "triggerEventSponsorEnterpriseLinked",
  [TRIGGER_EVENTS.SPONSOR_ENTERPRISE_UNLINKED]: "triggerEventSponsorEnterpriseUnlinked",
  [TRIGGER_EVENTS.JUDGE_ENTERPRISE_ASSIGNED]: "triggerEventJudgeEnterpriseAssigned",
  [TRIGGER_EVENTS.JUDGE_ENTERPRISE_REMOVED]: "triggerEventJudgeEnterpriseRemoved",
};

export function triggerEventLabel(event: string, t: Translate): string {
  const key = TRIGGER_EVENT_LABEL_KEYS[event];
  return key ? t(key) : event;
}

/**
 * Human label for a rule's trigger, covering BOTH mutually-exclusive kinds
 * (H8): a fixed trigger_event (triggerEventLabel above) or
 * sourceRoleId — "when this role is assigned" — which has no fixed registry
 * entry since the role itself IS the admin-chosen parameter.
 */
export function ruleTriggerLabel(
  rule: Pick<RoleGrantRule, "triggerEvent" | "sourceRoleId" | "sourceRoleName">,
  t: Translate,
): string {
  if (rule.sourceRoleId !== null) {
    return t("triggerSourceRoleAssigned", { roleName: rule.sourceRoleName ?? "" });
  }
  return triggerEventLabel(rule.triggerEvent ?? "", t);
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
