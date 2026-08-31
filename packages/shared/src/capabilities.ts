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
  // Deprecated compatibility no-op: preserved/reported for repair, never an authorization grant.
  SPONSOR_PORTAL: "sponsor:portal",

  // challenges (H43-H46, H8): split from SPONSORS_MANAGE so a role can create/
  // edit/publish sponsor challenges without full enterprise/tier/invite
  // administration — held internally by Hacker Experience and Sponsors Team.
  // A challenge's own enterprise still gates ownership-scoped edits via the
  // relationship check in challenges/access.ts; this capability only widens
  // WHO may attempt org-wide challenge management, same as SPONSORS_MANAGE
  // and QUEUE_ADMIN already did.
  CHALLENGES_MANAGE: "challenges:manage",

  // content (H45, H47-H50)
  SCHEDULE_MANAGE: "schedule:manage",
  ANNOUNCEMENTS_MANAGE: "announcements:manage",
  TV_CONTROL: "tv:control",

  // event settings (H45, H47, H19, H24, H42) — split from the former
  // catch-all SCHEDULE_MANAGE gate on /api/event, one capability per
  // settings tab so access can be granted per actual job (a venue lead
  // isn't necessarily the wallet-pass designer).
  EVENT_MANAGE: "event:manage", // identity + timing (name, tagline, timezone, event/hacking windows)
  VENUE_MANAGE: "venue:manage", // venue name/GPS + Wi-Fi credentials
  WALLET_MANAGE: "wallet:manage", // Apple Wallet pass fields/labels
  PRESENCE_MANAGE: "presence:manage", // H24 automatic-presence policy

  // comms & admin (H50-H54)
  NOTIFICATIONS_SEND: "notifications:send",
  AUDIT_READ: "audit:read",
  EXPORTS_RUN: "exports:run",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const ALL_CAPABILITIES: Capability[] = Object.values(CAPABILITIES);

/**
 * Short, factual, English-only description of what each capability grants
 * (H8). This is the raw catalogue — no i18n machinery lives in
 * `packages/shared`, so UI surfaces that show these to a user translate them
 * via their own locale files (e.g. `apps/web/src/app/(app)/permissions/helpers.ts`
 * maps each capability to a `capabilityDescription*` message key) rather than
 * rendering this English text directly. Keep entries terse — what the
 * capability lets someone do, not a sentence with filler.
 */
export const CAPABILITY_DESCRIPTIONS: Record<Capability, string> = {
  "*": "Grants every capability, unconditionally",
  "users:read": "Read any user's profile",
  "users:write": "Edit any user's profile",
  "permissions:manage": "Manage roles and capability assignments",
  "invites:manage": "Manage invite links and pre-assigned roles",
  "applications:manage": "Define application forms and open/close applications",
  "applications:review": "Read and score submitted applications",
  "applications:decide": "Accept or reject applications and send decisions",
  "applications:confirm-override": "Override a participant's confirm/decline as an admin",
  "applications:edit-response": "Edit any applicant's form responses",
  "projects:read": "Read project and Devpost submissions",
  "projects:import": "Import projects from Devpost",
  "projects:edit": "Edit project and Devpost submissions",
  "accredit:scan": "Check participants in and assign or rotate badges",
  "presence:scan": "Scan door entry and exit",
  "activity:scan": "Scan meals and registrable activities",
  "logistics:stats": "View attendance and logistics statistics panels",
  "intolerances:manage": "Maintain the food-intolerance dictionary",
  "queue:operate": "Call, skip, mark no-show, pause, or requeue teams",
  "queue:admin": "Manage rooms, assignments, settings, and disqualifications",
  "judge:panel": "Bring in, start, and evaluate judging sessions",
  "judging:export": "Export judging scores and results",
  "sponsors:manage": "Manage enterprises, tiers, and sponsor invites",
  "sponsor:portal": "Deprecated compatibility no-op — grants nothing",
  "challenges:manage": "Create, edit, and publish sponsor challenges",
  "schedule:manage": "Manage the event schedule",
  "announcements:manage": "Create and send announcements",
  "tv:control": "Control what displays on TV screens",
  "event:manage": "Edit event identity and timing windows",
  "venue:manage": "Edit venue location and Wi-Fi credentials",
  "wallet:manage": "Edit Apple Wallet pass fields and labels",
  "presence:manage": "Configure automatic-presence policy",
  "notifications:send": "Send notifications to users",
  "audit:read": "Read the audit log",
  "exports:run": "Run data exports",
};
