/** Subset of GET /api/me's response (apps/api/src/modules/identity/routes/profile.ts) this app reads. */
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
  mobileAccess: boolean;
  capabilities: string[];
}

/** Anonymous event details shown before sign-in. */
export interface PublicEvent {
  name: string | null;
  tagline: string | null;
}
