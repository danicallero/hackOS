/**
 * Capability catalogue (H8): permissions are checked against these concrete
 * capability strings, never against illustrative roles. Groups grant sets of
 * capabilities; groups can include other groups.
 *
 * `*` is the admin wildcard: a group holding it passes every check.
 *
 * Naming: `<domain>:<action>`. Add new capabilities here (single source),
 * never as inline string literals in route code.
 */
export const CAPABILITIES = {
  ADMIN_ALL: "*",

  // identity & permissions (H7, H8, H10)
  USERS_READ: "users:read",
  USERS_WRITE: "users:write",
  PERMISSIONS_MANAGE: "permissions:manage",
  INVITES_MANAGE: "invites:manage",

  // applications (H11-H15)
  APPLICATIONS_MANAGE: "applications:manage", // define forms, open/close
  APPLICATIONS_REVIEW: "applications:review", // read + score submitted responses
  APPLICATIONS_DECIDE: "applications:decide", // accept/reject, send decisions
  APPLICATIONS_CONFIRM_OVERRIDE: "applications:confirm-override", // admin confirm/decline override (H15)
  APPLICATIONS_EDIT_RESPONSE: "applications:edit-response", // edit any response's form data

  // projects / devpost (H16-H17, H21)
  PROJECTS_READ: "projects:read",
  PROJECTS_IMPORT: "projects:import",
  PROJECTS_EDIT: "projects:edit",

  // accreditation & logistics (H22-H26)
  ACCREDIT_SCAN: "accredit:scan", // check-in + badge assignment/rotation
  PRESENCE_SCAN: "presence:scan", // door in/out
  ACTIVITY_SCAN: "activity:scan", // meals + registrable activities
  LOGISTICS_STATS: "logistics:stats", // H24/H27 panels
  INTOLERANCES_MANAGE: "intolerances:manage", // maintain the food-intolerance dictionary

  // queue & judging (H29-H40)
  QUEUE_OPERATE: "queue:operate", // call/skip/no-show/pause/requeue
  QUEUE_ADMIN: "queue:admin", // rooms, assignments, settings, disqualify
  JUDGE_PANEL: "judge:panel", // bring in / start / evaluate
  JUDGING_EXPORT: "judging:export",

  // sponsors (H43-H46)
  SPONSORS_MANAGE: "sponsors:manage", // org-side: enterprises, tiers, invites
  SPONSOR_PORTAL: "sponsor:portal", // staff-side: manage/grant sponsor portal access

  // content (H45, H47-H50)
  SCHEDULE_MANAGE: "schedule:manage",
  ANNOUNCEMENTS_MANAGE: "announcements:manage",
  TV_CONTROL: "tv:control",

  // comms & admin (H50-H54)
  NOTIFICATIONS_SEND: "notifications:send",
  AUDIT_READ: "audit:read",
  EXPORTS_RUN: "exports:run",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ALL_CAPABILITIES: Capability[] = Object.values(CAPABILITIES);
