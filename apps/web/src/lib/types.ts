import type { Capability } from "@hackos/shared/capabilities";

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
