import type { Capability } from "@hackos/shared/capabilities";
import type { PassFieldLabels, PassFieldVisibility } from "@hackos/shared/wallet-pass-labels";
import type { I18nText, MessageKey } from "./i18n";

export interface Me {
  id: number;
  email: string;
  emailVerified: boolean;
  name: string | null;
  surname: string | null;
  image: string | null;
  dni: string | null;
  badgeId: string | null;
  language: string;
  secondaryEmail: string | null;
  secondaryEmailVerified: boolean;
  foodIntolerances: number[];
  foodIntoleranceNotes: string | null;
  shirtSize: string | null;
  universityId: number | null;
  notes: string | null;
  accountState: "active" | "removal_pending";
  isTestAccount: boolean;
  removal:
    | {
        status: "pending_exit";
        action: "anonymize";
        expiresAt: string;
        canCancel: true;
      }
    | {
        status: "processing";
        action: "delete" | "anonymize";
        expiresAt: string | null;
        canCancel: false;
      }
    | null;
  createdAt: string;
  /** H8: the caller's actual highest-visible role name (null if they hold no visible role). */
  visibleRoleName: string | null;
  capabilities: Capability[];
  /** H8: the caller's complete assigned-role set, highest position first — additive next to `visibleRoleName`. */
  roles: AssignedRoleSummary[];
  /** Association facts underlying `visibleRoleName` (H55) — a sponsor rep who also judges needs both workspaces. */
  isEnterpriseJudge: boolean;
  isSponsorRep: boolean;
  /** Confirmed spot or manual attendee role — drives ticket/wallet exposure and participant-only nav. */
  hasEventAccess: boolean;
  /** Has a project of their own (submission or Devpost participant) — drives My project nav visibility (issue #424). */
  hasProject: boolean;
  /** Has at least one active queue entry — drives My queue nav visibility (issue #424). */
  hasQueueItems: boolean;
  /** H19 self-creation is currently open to this caller — keeps My project visible without a project yet. */
  canCreateProject: boolean;
  /** H7: once an application is accepted, name/shirt-size/dietary fields are no longer self-editable. */
  profileLocked: boolean;
}

export type Language = "en" | "es" | "gl";

export interface UserListItem {
  id: number;
  email: string;
  emailVerified: boolean;
  name: string | null;
  surname: string | null;
  badgeId: string | null;
  /** H8: this user's actual highest-visible role name (null if they hold no visible role). */
  visibleRoleName: string | null;
  language: string;
  shirtSize: string | null;
  applicationStatus: string | null;
  confirmedSpot: boolean;
  isTestAccount: boolean;
  createdAt: string;
}
export interface UserList {
  users: UserListItem[];
  total: number;
}

/** H8: an entry in a user's full assigned-role list (see `Me.roles`/`UserDetail.roles`). */
export interface AssignedRoleSummary {
  id: number;
  name: string;
  position: number;
  isVisible: boolean;
}

export interface UserDetail extends Omit<Me, "visibleRoleName" | "capabilities" | "roles"> {
  visibleRoleName: string | null;
  capabilities: Capability[];
  roles: AssignedRoleSummary[];
}

export type PermissionState = "allow" | "deny" | "inherit";

/** GET /api/roles item (H8: the hierarchical, position-ordered multi-role model). */
export interface RoleSummary {
  id: number;
  name: string;
  /** One global hierarchy — higher sorts first. */
  position: number;
  /** Whether this can be shown as a user's public role. */
  isVisible: boolean;
  /** Built-in roles (e.g. Platform administrator). Informational only — see deletedAt/name for what's actually locked. */
  isProtected: boolean;
  /** H8/0800: true for a role from the seeded default catalogue (0801 Sponsor / 0805). Scopes trash/restore and gates reset-to-default. */
  isSeeded: boolean;
  /** Sparse: a capability with no explicit row is implicitly 'inherit'. */
  capabilities: { capability: string; state: PermissionState }[];
  memberIds: number[];
  /** H8/0804: soft-delete marker. Non-null means this role grants nothing and is hidden from the default list. */
  deletedAt: string | null;
}
/** GET /api/roles/:id — identical shape to the list item. */
export type RoleDetail = RoleSummary;

/** GET /api/roles/:id/seed-diff — a seeded role's drift from its seed-time snapshot. */
export interface RoleSeedDiff {
  isSeeded: boolean;
  hasDrifted: boolean;
  diff: { capability: string; current: PermissionState; default: PermissionState }[];
}

/** GET/POST/PATCH /api/role-grant-rules item (H8: admin-configurable automatic role grant/revoke rules). */
export interface RoleGrantRule {
  id: number;
  roleId: number;
  roleName: string;
  /** Mutually exclusive with sourceRoleId — null when this rule fires off sourceRoleId instead (0812). */
  triggerEvent: string | null;
  /** Mutually exclusive with triggerEvent — set means "fires when this role is assigned/removed" (H8 role-assignment-as-trigger, 0812). */
  sourceRoleId: number | null;
  sourceRoleName: string | null;
  action: "grant" | "revoke";
  enabled: boolean;
  /** null = applies to every occurrence of triggerEvent, not just one enterprise. */
  enterpriseId: number | null;
  enterpriseName: string | null;
}

/** GET /api/role-templates item. Keys select the web i18n catalogue. */
export interface RoleTemplate {
  key: string;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  capabilities: Capability[];
}

/** Food-intolerance dictionary entry (GET /api/public/food-intolerances). */
export interface Intolerance {
  id: number;
  label: I18nText;
  description: I18nText | null;
}

export interface PassBackField {
  label: string;
  value: string;
}

/** GET/PUT /api/event. */
export interface EventConfig {
  name: string | null;
  tagline: string | null;
  timezone: string;
  /** Doors open — the time shown on the Apple Wallet pass. Not the hacking start. */
  eventStartsAt: string | null;
  /** Event over — the Wallet pass expires then. Not the hacking end. */
  eventEndsAt: string | null;
  hackingStartsAt: string | null;
  hackingEndsAt: string | null;
  showStartCountdown: boolean;
  /** H19: participants may create their own project while enabled. */
  participantsCanCreateProjects: boolean;
  /** Optional common entry instant used for people accredited earlier. */
  presenceAutoEntryAt: string | null;
  /** Maximum time without an exit or activity signal before provisional time is invalidated. */
  presenceCertaintyWindowMinutes: number;
  judgingStartsAt: string | null;
  judgingEndsAt: string | null;
  venueName: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  /**
   * Venue Wi-Fi shown on the TV screens (H42). Absent from /api/public/event —
   * only the settings page and the TV feed (/api/tv/config) serve it.
   */
  wifiSsid: string | null;
  wifiPassword: string | null;
  passBackFields: PassBackField[];
  passFieldLabels: PassFieldLabels;
  passFieldVisibility: PassFieldVisibility;
  /** Read-only: what the pass's "Organized by" back field is filled with. */
  organizerName: string;
  /** H10: whether an invited sponsor/staff account must supply a shirt size / sees dietary fields when claiming. */
  requireSponsorShirtSize: boolean;
  requireSponsorDietary: boolean;
  requireStaffShirtSize: boolean;
  requireStaffDietary: boolean;
  /** H12: the options every shirt-size picker in the app renders. */
  shirtSizes: string[];
}

export type InviteKind = "staff" | "sponsor" | "participant";

/** POST /api/invites response. */
export interface Invite {
  id: number;
  email: string;
  kind: InviteKind;
  enterpriseId: number | null;
  roleIds: number[];
  expiresAt: string;
  usedAt: string | null;
  token: string | null;
}

/** GET /api/invites — active invitation list item. */
export interface InviteListItem {
  id: number;
  email: string;
  kind: InviteKind;
  enterpriseId: number | null;
  roleIds: number[];
  expiresAt: string;
  createdAt: string;
}

/** GET /api/invites/lookup — what the invitee sees before accepting. */
export interface InviteLookup {
  email: string | null;
  kind: InviteKind;
  enterpriseName: string | null;
  reusable: boolean;
  maxRedeems: number | null;
  redeemedCount: number;
  remainingRedeems: number | null;
  expired: boolean;
  /** Whether this claim must supply a shirt size / should show dietary fields (H10). */
  requireShirtSize: boolean;
  requireDietary: boolean;
}

/** GET/POST /api/invites/enterprise-links. */
export interface EnterpriseInviteLink {
  id: number;
  enterpriseId: number;
  enterpriseName: string;
  token: string;
  url: string;
  maxRedeems: number | null;
  redeemedCount: number;
  remainingRedeems: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "exhausted" | "withdrawn";
  redemptions: Array<{
    id: number;
    userId: number | null;
    email: string;
    name: string | null;
    redeemedAt: string;
  }>;
}

/** GET/POST /api/invites/user-links — reusable account-creation links (H10). */
export interface UserInviteLink {
  id: number;
  kind: InviteKind;
  enterpriseId: number | null;
  enterpriseName: string | null;
  roleIds: number[];
  token: string;
  url: string;
  maxRedeems: number | null;
  redeemedCount: number;
  remainingRedeems: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "exhausted" | "withdrawn";
  redemptions: Array<{
    id: number;
    userId: number | null;
    email: string;
    name: string | null;
    redeemedAt: string;
  }>;
}

/** Minimal enterprise shape for the sponsor-invite picker (GET /api/enterprises). */
export interface EnterpriseSummary {
  id: number;
  name: string;
}
