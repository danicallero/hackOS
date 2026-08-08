import type { Capability } from "@hackos/shared/capabilities";
import type { PassFieldLabels, PassFieldVisibility } from "@hackos/shared/wallet-pass-labels";
import type { I18nText } from "./i18n";

export interface Me {
  id: number;
  email: string;
  emailVerified: boolean;
  name: string | null;
  surname: string | null;
  phone: string | null;
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
  createdAt: string;
  role: "admin" | "judge" | "sponsor" | "staff" | "mentor" | "participant" | "unassigned";
  capabilities: Capability[];
  /** Association facts underlying `role` (H55) — a sponsor rep who also judges needs both workspaces. */
  isRoomJudge: boolean;
  isSponsorRep: boolean;
}

export type Language = "en" | "es" | "gl";
export type DerivedRole =
  | "admin"
  | "judge"
  | "sponsor"
  | "staff"
  | "mentor"
  | "participant"
  | "unassigned";

export interface UserListItem {
  id: number;
  email: string;
  emailVerified: boolean;
  name: string | null;
  surname: string | null;
  badgeId: string | null;
  role: DerivedRole;
  phone: string | null;
  language: string;
  shirtSize: string | null;
  applicationStatus: string | null;
  confirmedSpot: boolean;
  createdAt: string;
}
export interface UserList {
  users: UserListItem[];
  total: number;
}

export interface UserDetail extends Omit<Me, "role" | "capabilities"> {
  role: DerivedRole;
  capabilities: Capability[];
  groups: { id: number; name: string }[];
}

/** GET /api/permission-groups item. */
export interface PermissionGroupSummary {
  id: number;
  name: string;
  description: string | null;
  /** Originating platform template, if this group was created from one. */
  templateKey: string | null;
  /** True when direct capabilities or includes no longer match the template. */
  templateDrifted: boolean;
}
/** GET /api/permission-groups/:id — full group. */
export interface PermissionGroupDetail extends PermissionGroupSummary {
  capabilities: string[];
  includes: number[];
  members: number[];
}

/** GET /api/permission-group-templates item. Keys select the web i18n catalogue. */
export interface PermissionGroupTemplate {
  key: string;
  labelKey: string;
  descriptionKey: string;
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
}

export type InviteKind = "staff" | "sponsor" | "participant";

/** POST /api/invites response. */
export interface Invite {
  id: number;
  email: string;
  kind: InviteKind;
  enterpriseId: number | null;
  groupIds: number[];
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
  groupIds: number[];
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

/** Minimal enterprise shape for the sponsor-invite picker (GET /api/enterprises). */
export interface EnterpriseSummary {
  id: number;
  name: string;
}
