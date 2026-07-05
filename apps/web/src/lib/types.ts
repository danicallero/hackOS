import type { Capability } from "@hackos/shared/capabilities";
import type { I18nText } from "./i18n";

/** Shape of GET /api/me (apps/api/src/modules/identity/routes/profile.ts). */
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
  /** Illustrative only — never gate on this, use capabilities (H8). */
  role: "admin" | "judge" | "sponsor" | "staff" | "participant";
  capabilities: Capability[];
}

export type Language = "en" | "es" | "gl";
export type DerivedRole = "admin" | "judge" | "sponsor" | "staff" | "participant";

/** GET /api/users item. */
export interface UserListItem {
  id: number;
  email: string;
  emailVerified: boolean;
  name: string | null;
  surname: string | null;
  badgeId: string | null;
  createdAt: string;
}
export interface UserList {
  users: UserListItem[];
  total: number;
}

/** GET /api/users/:id — full record + derived role, capabilities and groups. */
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

/** GET/PUT /api/event. */
export interface EventConfig {
  name: string | null;
  tagline: string | null;
  timezone: string;
  hackingStartsAt: string | null;
  hackingEndsAt: string | null;
}
