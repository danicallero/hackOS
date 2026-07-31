import { CAPABILITIES, type Capability } from "@hackos/shared/capabilities";

/**
 * H8's platform templates are a code catalogue, not database roles. Labels
 * are message keys only; clients resolve them in their own trilingual copy.
 */
export interface PermissionGroupTemplate {
  key: string;
  labelKey: string;
  descriptionKey: string;
  capabilities: readonly Capability[];
}

function template(
  key: string,
  labelKey: string,
  descriptionKey: string,
  capabilities: readonly Capability[],
): PermissionGroupTemplate {
  return { key, labelKey, descriptionKey, capabilities };
}

export const PERMISSION_GROUP_TEMPLATES: readonly PermissionGroupTemplate[] = [
  template(
    "platform-administrator",
    "permissionTemplatePlatformAdministrator",
    "permissionTemplatePlatformAdministratorDescription",
    [CAPABILITIES.ADMIN_ALL],
  ),
  template(
    "access-administrator",
    "permissionTemplateAccessAdministrator",
    "permissionTemplateAccessAdministratorDescription",
    [
      CAPABILITIES.USERS_READ,
      CAPABILITIES.USERS_WRITE,
      CAPABILITIES.PERMISSIONS_MANAGE,
      CAPABILITIES.INVITES_MANAGE,
      CAPABILITIES.AUDIT_READ,
    ],
  ),
  template(
    "application-builder",
    "permissionTemplateApplicationBuilder",
    "permissionTemplateApplicationBuilderDescription",
    [CAPABILITIES.APPLICATIONS_MANAGE],
  ),
  template(
    "application-reviewer",
    "permissionTemplateApplicationReviewer",
    "permissionTemplateApplicationReviewerDescription",
    [CAPABILITIES.APPLICATIONS_REVIEW],
  ),
  template(
    "application-decisions",
    "permissionTemplateApplicationDecisions",
    "permissionTemplateApplicationDecisionsDescription",
    [CAPABILITIES.APPLICATIONS_REVIEW, CAPABILITIES.APPLICATIONS_DECIDE],
  ),
  template(
    "application-supervisor",
    "permissionTemplateApplicationSupervisor",
    "permissionTemplateApplicationSupervisorDescription",
    [
      CAPABILITIES.APPLICATIONS_MANAGE,
      CAPABILITIES.APPLICATIONS_REVIEW,
      CAPABILITIES.APPLICATIONS_DECIDE,
      CAPABILITIES.APPLICATIONS_CONFIRM_OVERRIDE,
      CAPABILITIES.APPLICATIONS_EDIT_RESPONSE,
    ],
  ),
  template(
    "project-operator",
    "permissionTemplateProjectOperator",
    "permissionTemplateProjectOperatorDescription",
    [CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_IMPORT, CAPABILITIES.PROJECTS_EDIT],
  ),
  template(
    "queue-operator",
    "permissionTemplateQueueOperator",
    "permissionTemplateQueueOperatorDescription",
    [CAPABILITIES.PROJECTS_READ, CAPABILITIES.QUEUE_OPERATE, CAPABILITIES.JUDGING_EXPORT],
  ),
  template(
    "judging-administrator",
    "permissionTemplateJudgingAdministrator",
    "permissionTemplateJudgingAdministratorDescription",
    [
      CAPABILITIES.PROJECTS_READ,
      CAPABILITIES.QUEUE_OPERATE,
      CAPABILITIES.QUEUE_ADMIN,
      CAPABILITIES.JUDGE_PANEL,
      CAPABILITIES.JUDGING_EXPORT,
    ],
  ),
  template(
    "accreditation-station",
    "permissionTemplateAccreditationStation",
    "permissionTemplateAccreditationStationDescription",
    [CAPABILITIES.ACCREDIT_SCAN],
  ),
  template(
    "presence-station",
    "permissionTemplatePresenceStation",
    "permissionTemplatePresenceStationDescription",
    [CAPABILITIES.PRESENCE_SCAN],
  ),
  template(
    "activity-and-meal-station",
    "permissionTemplateActivityAndMealStation",
    "permissionTemplateActivityAndMealStationDescription",
    [CAPABILITIES.ACTIVITY_SCAN],
  ),
  template(
    "logistics-supervisor",
    "permissionTemplateLogisticsSupervisor",
    "permissionTemplateLogisticsSupervisorDescription",
    [
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.PRESENCE_SCAN,
      CAPABILITIES.ACTIVITY_SCAN,
      CAPABILITIES.LOGISTICS_STATS,
    ],
  ),
  template(
    "programme-manager",
    "permissionTemplateProgrammeManager",
    "permissionTemplateProgrammeManagerDescription",
    [CAPABILITIES.SCHEDULE_MANAGE],
  ),
  template(
    "tv-operator",
    "permissionTemplateTvOperator",
    "permissionTemplateTvOperatorDescription",
    [CAPABILITIES.TV_CONTROL],
  ),
  template(
    "sponsor-administrator",
    "permissionTemplateSponsorAdministrator",
    "permissionTemplateSponsorAdministratorDescription",
    [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.INVITES_MANAGE, CAPABILITIES.USERS_READ],
  ),
  template(
    "communications-manager",
    "permissionTemplateCommunicationsManager",
    "permissionTemplateCommunicationsManagerDescription",
    [CAPABILITIES.ANNOUNCEMENTS_MANAGE, CAPABILITIES.NOTIFICATIONS_SEND],
  ),
  template(
    "data-auditor",
    "permissionTemplateDataAuditor",
    "permissionTemplateDataAuditorDescription",
    [CAPABILITIES.AUDIT_READ, CAPABILITIES.EXPORTS_RUN, CAPABILITIES.USERS_READ],
  ),
  template(
    "content-library-manager",
    "permissionTemplateContentLibraryManager",
    "permissionTemplateContentLibraryManagerDescription",
    [CAPABILITIES.INTOLERANCES_MANAGE],
  ),
];

export function getPermissionGroupTemplate(key: string): PermissionGroupTemplate | undefined {
  return PERMISSION_GROUP_TEMPLATES.find((template) => template.key === key);
}
