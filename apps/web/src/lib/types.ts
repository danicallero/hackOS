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
  role: "admin" | "judge" | "sponsor" | "staff" | "participant";
  capabilities: Capability[];
}

export type Language = "en" | "es" | "gl";
export type DerivedRole = "admin" | "judge" | "sponsor" | "staff" | "participant";

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
}
/** GET /api/permission-groups/:id — full group. */
export interface PermissionGroupDetail extends PermissionGroupSummary {
  capabilities: string[];
  includes: number[];
  members: number[];
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
  /** Optional common entry instant used for people accredited earlier. */
  presenceAutoEntryAt: string | null;
  /** Maximum time without an exit or activity signal before provisional time is invalidated. */
  presenceCertaintyWindowMinutes: number;
  judgingStartsAt: string | null;
  judgingEndsAt: string | null;
  venueName: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  passBackFields: PassBackField[];
  passFieldLabels: PassFieldLabels;
  passFieldVisibility: PassFieldVisibility;
  /** Read-only: what the pass's "Organized by" back field is filled with. */
  organizerName: string;
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
  email: string;
  kind: InviteKind;
  enterpriseName?: string | null;
  expired?: boolean;
}

/** Minimal enterprise shape for the sponsor-invite picker (GET /api/enterprises). */
export interface EnterpriseSummary {
  id: number;
  name: string;
}
