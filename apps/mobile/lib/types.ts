/** Subset of GET /api/me's response (apps/api/src/modules/identity/routes/profile.ts) this app reads. */
export interface Me {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
  badgeId: string | null;
  language: string;
  role: "admin" | "judge" | "sponsor" | "staff" | "participant";
  capabilities: string[];
}
