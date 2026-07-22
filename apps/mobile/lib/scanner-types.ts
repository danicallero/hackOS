export type ScanKind =
  | "accreditation"
  | "accreditation_user"
  | "badge_rotation"
  | "badge_removal"
  | "presence"
  | "activity";

export interface ScannerPerson {
  userId: number;
  email: string;
  role: "admin" | "judge" | "sponsor" | "staff" | "mentor" | "participant" | "unassigned";
  ticketToken: string | null;
  badgeId: string | null;
  revokedBadgeIds: string[];
  name: string | null;
  surname: string | null;
  accepted: boolean;
  confirmed: boolean;
  intolerances: Array<{ id: number; label: Record<string, string> }>;
  foodIntoleranceNotes: string | null;
  notes: string | null;
  lastPresenceKind: "in" | "out" | null;
  lastPresenceAt: string | null;
}

export interface ScannerActivity {
  id: number;
  name: string;
  category: string;
  requiresScan: boolean;
  startsAt: string | null;
}

export interface ScannerActivityState {
  userId: number;
  activityId: number;
  count: number;
}

export interface ScannerSnapshot {
  generatedAt: string;
  people: ScannerPerson[];
  activities: ScannerActivity[];
  activityStates: ScannerActivityState[];
}

export type ScanPayload =
  | { kind: "accreditation"; ticketToken: string; badgeId: string; method: "qr" | "manual" }
  | {
      kind: "accreditation_user";
      userId: number;
      badgeId: string;
      method: "qr" | "manual";
      attendeeRole?: "participant" | "mentor";
    }
  | {
      kind: "badge_rotation";
      userId: number;
      currentBadgeId: string;
      newBadgeId: string;
      reason: string;
    }
  | { kind: "badge_removal"; userId: number; currentBadgeId: string; reason: string }
  | { kind: "presence"; badgeId: string; direction: "in" | "out"; scannedAt: string }
  | {
      kind: "activity";
      activityId: number;
      badgeId: string;
      allowRepeat: boolean;
      scannedAt: string;
    };

export interface PendingScan {
  id: string;
  kind: ScanKind;
  payload: ScanPayload;
  status: "pending" | "acknowledged" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  /** Whether a device-clock-skew timestamp correction has already been applied (see scanner-sync.ts). */
  clockCorrected: boolean;
}
