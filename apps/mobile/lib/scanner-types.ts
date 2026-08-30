export type ScanKind =
  | "accreditation"
  | "accreditation_user"
  | "badge_rotation"
  | "badge_removal"
  | "presence"
  | "activity"
  | "presence_signal"
  | "presence_signal_activity"
  | "presence_signal_edit_door"
  | "presence_signal_edit_activity"
  | "presence_signal_delete";

export interface ScannerPerson {
  userId: number;
  email: string;
  role: "admin" | "staff" | "sponsor" | "mentor" | "judge" | "participant" | "unassigned";
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
  /** H50 extension: mirrors the linked schedule item's translations — see resolveActivityText. */
  primaryLanguage: "es" | "gl" | "en";
  nameI18n: Partial<Record<"es" | "gl" | "en", string>>;
  descriptionI18n: Partial<Record<"es" | "gl" | "en", string | null>>;
}

/**
 * Resolves what a viewer sees for a scannable activity's name (H50 extension,
 * mirrors lib/schedule.ts's resolveScheduleText): their preferred language if
 * translated, else English, else the item's primary (authored) language —
 * never blank, since primaryLanguage's canonical `name` is always filled.
 */
export function resolveActivityText(
  item: Pick<ScannerActivity, "name" | "primaryLanguage" | "nameI18n">,
  language: "es" | "gl" | "en",
): string {
  if (language === item.primaryLanguage) return item.name;
  const translated = item.nameI18n[language];
  if (translated) return translated;
  if (language !== "en") {
    const english = item.nameI18n.en;
    if (english) return english;
  }
  return item.name;
}

export interface ScannerActivityState {
  userId: number;
  activityId: number;
  count: number;
}

export interface ScannerSnapshot {
  generatedAt: string;
  /** Short-lived H54 revocations with no participant/user relationship. */
  revokedBadgeIds?: string[];
  /** Short-lived H54 ticket revocations with no participant/user relationship. */
  revokedTicketTokens?: string[];
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
    }
  // Manual presence-timeline create/edit/delete via the unrestricted
  // presence-signal endpoints (not the gated /api/presence/scan `presence`
  // kind above) — e.g. backfilling an entry for a session an activity opened
  // with no door scan behind it, or the "Add event"/edit/delete flows on the
  // timeline editor itself.
  | {
      kind: "presence_signal";
      userId: number;
      direction: "in" | "out";
      occurredAt: string;
      notes?: string | null;
    }
  | {
      kind: "presence_signal_activity";
      userId: number;
      activityId: number;
      occurredAt: string;
      notes?: string | null;
    }
  | {
      kind: "presence_signal_edit_door";
      logId: number;
      direction?: "in" | "out";
      occurredAt?: string;
      notes?: string | null;
    }
  | {
      kind: "presence_signal_edit_activity";
      logId: number;
      activityId?: number;
      occurredAt?: string;
      notes?: string | null;
    }
  | {
      kind: "presence_signal_delete";
      source: "door" | "activity";
      logId: number;
      /** Local context retained so a failed delete can be reconciled later. */
      userId?: number;
      /** Badge active when the operator created the delete request. */
      badgeId?: string | null;
      occurredAt?: string;
      direction?: "in" | "out";
      activityId?: number | null;
      notes?: string | null;
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

/** Local, non-sensitive audit trail for every failed queue replay attempt. */
export interface ScannerSyncErrorEntry {
  id: number;
  scanId: string;
  kind: ScanKind;
  type: "retryable" | "rejected";
  message: string;
  occurredAt: string;
}
