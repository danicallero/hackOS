export type ScanKind = "accreditation" | "badge_rotation" | "presence" | "activity";

export interface ScannerPerson {
  userId: number;
  ticketToken: string | null;
  badgeId: string | null;
  revokedBadgeIds: string[];
  name: string | null;
  surname: string | null;
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
}

export interface ScannerActivityState {
  userId: number;
  activityId: number;
  count: number;
  entitled: boolean;
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
      kind: "badge_rotation";
      userId: number;
      currentBadgeId: string;
      newBadgeId: string;
      reason: string;
    }
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
}
