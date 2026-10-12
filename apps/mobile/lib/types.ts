/** Subset of GET /api/me's response (apps/api/src/modules/identity/routes/profile.ts) this app reads. */
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
  /**
   * The user's actual highest-visible role name, or null when none (H8 —
   * badge_category retired). This preserves the canonical GET /api/me field
   * name rather than creating a mobile-only identity alias.
   */
  visibleRoleName: string | null;
  /** True when the account has at least one assigned role with event_access. */
  hasEventAccess: boolean;
  hasQueueItems: boolean;
  capabilities: string[];
  // Optional: an offline profile cached by an older build lacks these (#933).
  /** #933: last explicit dietary answer, including "no restrictions". */
  dietaryConfirmedAt?: string | null;
  /** H7: dietary fields are no longer self-editable after an accepted application. */
  profileLocked?: boolean;
  isSponsorRep?: boolean;
  /** #933: profile data to ask for on next entry. */
  pendingProfileTasks?: ProfileTask[];
}

export type ProfileTask = "dietary" | "meal_plan";

/** GET/PUT /api/me/meal-plan (#933). */
export interface MealPlan {
  confirmedAt: string | null;
  meals: {
    activityId: number;
    name: string;
    nameI18n: Record<string, string> | null;
    startsAt: string;
    endsAt: string;
    location: string | null;
    attending: boolean | null;
    locked: boolean;
  }[];
}

/** Anonymous event details shown before sign-in. */
export interface PublicEvent {
  name: string | null;
  tagline: string | null;
}
