import { api } from "@/lib/api";

export interface PersonCard {
  userId: number;
  name: string | null;
  surname: string | null;
  intolerances: { id: number; label: Record<string, string> | unknown }[];
  foodIntoleranceNotes: string | null;
  notes: string | null;
}

export interface AccreditationLookup extends PersonCard {
  email: string | null;
  dni: string | null;
  shirtSize: string | null;
  confirmed: boolean;
  hasTicket: boolean;
  alreadyAccredited: boolean;
  currentBadge: string | null;
}

export interface AccreditationRoleCount {
  role: "admin" | "judge" | "sponsor" | "staff" | "mentor" | "participant" | "unassigned";
  count: number;
}

/** Fields the person search can return; pass the ones your station needs. */
export type PersonSearchField = "email" | "badgeId" | "dni" | "shirtSize" | "notes" | "confirmed";

export interface PersonSearchResult {
  userId: number;
  name: string | null;
  surname: string | null;
  matchedBy: "ticket" | "badge" | "badge_history" | "profile";
  /** Requested fields (defaults: email, badgeId, confirmed). */
  email?: string | null;
  badgeId?: string | null;
  dni?: string | null;
  shirtSize?: string | null;
  notes?: string | null;
  confirmed?: boolean;
}

export interface CheckInResult {
  userId: number;
  badgeId: string;
  method: "qr" | "manual" | "nfc";
  checkInLogId: number;
  checkedInAt: string;
  presenceEntryAt: string | null;
  name: string | null;
  surname: string | null;
}

export interface RotateBadgeResult {
  userId: number;
  oldBadge: string | null;
  newBadge: string;
  voidedPasses: number;
}

export interface PresenceEstimate {
  at: string;
  presentCount: number;
  present: number[];
}

export interface PresenceLookup extends PersonCard {
  badgeId: string;
  /** Whether the presence estimate currently has this person inside. */
  present: boolean;
  /** Ground truth: when their currently-open door session started, or null
   * if it's closed. An 'in' scan is rejected while this is set. */
  openSince: string | null;
}

export interface PresenceScanResult {
  logged: true;
  timeLogId: number;
  userId: number;
  kind: "in" | "out";
  scannedAt: string;
  manual: boolean;
}

export interface PresenceInterval {
  start: string;
  end: string;
  /** True when `end` is a real door 'out' scan; false when it's an estimate
   * (inferred from a gap, or the session is still open). */
  confirmed: boolean;
}

export interface PresenceHours {
  userId: number;
  name?: string | null;
  surname?: string | null;
  hours: number;
  intervals?: PresenceInterval[];
}

export interface TimeLogEntry {
  id: number;
  kind: "in" | "out";
  scannedAt: string;
  notes: string | null;
  // null = system-generated log (event-end automatic exit, H24)
  scannedBy: { userId: number; name: string | null; surname: string | null } | null;
}

export interface PresenceTimelineSignal {
  id: number;
  source: "door" | "activity";
  kind: "in" | "out" | "activity";
  occurredAt: string;
  activityId: number | null;
  activityName: string | null;
  category: string | null;
  notes: string | null;
  // null = system-generated log (event-end automatic exit, H24)
  recordedBy: { userId: number; name: string | null; surname: string | null } | null;
}

export interface PresenceCertaintyWindow {
  start: string;
  deadline: string;
  securedUntil: string | null;
  status: "secured" | "provisional" | "invalid";
  openedBy: "in" | "activity";
  closedBy: "in" | "out" | "activity" | null;
  /** Invalidated by an illegal in→in sequence (H24). */
  conflict: boolean;
}

/** Illegal in→in pair (H24): insert the missing exit/activity inside (from, to). */
export interface PresenceConflict {
  firstLogId: number;
  secondLogId: number;
  from: string;
  to: string;
}

export interface PresenceTimelineData {
  certaintyWindowMinutes: number;
  activities: Array<{ id: number; name: string; category: string }>;
  signals: PresenceTimelineSignal[];
  conflicts: PresenceConflict[];
  windows: PresenceCertaintyWindow[];
}

export interface TimeLogUpdateResult {
  id: number;
  userId: number;
  kind: "in" | "out";
  scannedAt: string;
  notes: string | null;
}

export interface OpenPresenceSession {
  userId: number;
  name: string | null;
  surname: string | null;
  since: string;
  lastSignal: string;
  /** No supporting signal (door or activity) for longer than the
   * suspicious-gap window — flagged for staff to double-check, not
   * auto-closed. */
  stale: boolean;
}

export interface ActivityScanResult {
  registered: boolean;
  firstTime: boolean;
  repeat: boolean;
  timesEaten: number;
  card: PersonCard;
  message?: string;
}

export interface StaffScanRankingRow {
  staffId: number;
  name: string;
  surname: string;
  accreditationCount: number;
  presenceCount: number;
  activityCount: number;
  total: number;
}

export interface LogisticsStats {
  accreditedCount: number;
  currentlyPresent: number;
  accreditedByRole: Array<{
    role: "admin" | "judge" | "sponsor" | "staff" | "mentor" | "participant" | "unassigned";
    count: number;
  }>;
  meals: Array<{
    activityId: number;
    name: string;
    served: number;
    distinctPeople: number;
    repeats: number;
  }>;
  activities: Array<{
    activityId: number;
    name: string;
    category: string;
    scans: number;
    attendees: number;
    repeats: number;
  }>;
}

export interface ScannableActivity {
  activityId: number;
  name: string;
  category: string;
  /** Total scans / servings logged. */
  count: number;
  /** Distinct people who passed through. */
  distinctPeople: number;
  /** count - distinctPeople (repeat servings / re-scans). */
  repeats: number;
}

export type ScheduleAudience = "sponsor" | "participant" | "mentor";
/**
 * Either a real hackOS account (userId set, name/surname/email from `users`)
 * or a free-text name with no login (freeTextName set) — never both.
 */
export interface ScheduleOwner {
  id: number;
  userId: number | null;
  name: string | null;
  surname: string | null;
  email?: string;
  freeTextName: string | null;
  assignedAt?: string;
}

export interface PublicScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  requiresScan?: boolean;
  startsAt: string;
  endsAt: string;
  visibility?: "shown" | "hidden";
  publishAt: string | null;
  remindedAt?: string | null;
  audiences?: ScheduleAudience[];
  contactNote?: string | null;
  /** Staff-only free-form notes — the run-of-show's "observations" column. */
  notes?: string | null;
  /** Only present on the audience-aware feed, when the caller shares a non-public audience. */
  owners?: ScheduleOwner[];
  createdAt?: string;
  updatedAt?: string;
}

export interface MealScanBatchResult {
  batchId: number;
  accepted: number;
  duplicate: number;
  queued: boolean;
}

export interface TicketQrPayload {
  userId: number;
  ticketToken: string | null;
  badgeId: string | null;
}

export interface ScheduleInput {
  title: string;
  description?: string | null;
  location?: string | null;
  type?: string | null;
  requiresScan?: boolean;
  startsAt: string;
  endsAt: string;
  visibility: "shown" | "hidden";
  publishAt?: string | null;
  audiences?: ScheduleAudience[];
  contactNote?: string | null;
  notes?: string | null;
}

export function idempotencyHeaders(prefix: string): Record<string, string> {
  return { "idempotency-key": `${prefix}-${crypto.randomUUID()}` };
}

export const logisticsApi = {
  searchPeople: (q: string, fields?: PersonSearchField[]) =>
    api.post<{ results: PersonSearchResult[] }>("/api/logistics/people/search", { q, fields }),
  lookup: (ticketToken: string) =>
    api.post<AccreditationLookup>("/api/accreditation/lookup", { ticketToken }),
  lookupUser: (userId: number) =>
    api.post<AccreditationLookup>("/api/accreditation/lookup-user", { userId }),
  accreditationStats: () =>
    api.get<{ byRole: AccreditationRoleCount[] }>("/api/accreditation/stats"),
  checkIn: (body: { ticketToken: string; badgeId: string; method: "qr" | "manual" | "nfc" }) =>
    api.post<CheckInResult>("/api/accreditation/check-in", body, {
      headers: idempotencyHeaders("check-in"),
    }),
  checkInUser: (body: { userId: number; badgeId: string; method: "qr" | "manual" | "nfc" }) =>
    api.post<CheckInResult>("/api/accreditation/check-in-user", body, {
      headers: idempotencyHeaders("check-in-user"),
    }),
  rotate: (body: {
    userId?: number;
    currentBadgeId?: string;
    newBadgeId: string;
    reason: string;
  }) =>
    api.post<RotateBadgeResult>("/api/accreditation/rotate", body, {
      headers: idempotencyHeaders("badge-rotate"),
    }),
  presenceLookup: (badgeId: string) =>
    api.post<PresenceLookup>("/api/presence/lookup", { badgeId }),
  presenceScan: (body: { badgeId: string; kind: "in" | "out"; scannedAt?: string }) =>
    api.post<PresenceScanResult>("/api/presence/scan", body, {
      headers: idempotencyHeaders("presence"),
    }),
  presenceEstimate: () => api.get<PresenceEstimate>("/api/presence/estimate"),
  presenceHours: () => api.get<PresenceHours[]>("/api/presence/hours"),
  presenceOpenSessions: () => api.get<{ items: OpenPresenceSession[] }>("/api/presence/open"),
  presenceLogs: (userId: number) =>
    api.get<{ items: TimeLogEntry[] }>(`/api/presence/logs/${userId}`),
  presenceTimeline: (userId: number) =>
    api.get<PresenceTimelineData>(`/api/presence/timeline/${userId}`),
  createPresenceSignal: (
    userId: number,
    body:
      | { kind: "in" | "out"; occurredAt: string; notes?: string | null }
      | { kind: "activity"; activityId: number; occurredAt: string; notes?: string | null },
  ) =>
    api.post<{ source: "door" | "activity"; id: number }>(`/api/presence/signals/${userId}`, body),
  updateTimeLog: (
    id: number,
    body: { kind?: "in" | "out"; scannedAt?: string; notes?: string | null },
  ) => api.patch<TimeLogUpdateResult>(`/api/presence/logs/${id}`, body),
  deleteTimeLog: (id: number) => api.delete<{ deleted: true }>(`/api/presence/logs/${id}`),
  updatePresenceActivity: (
    id: number,
    body: { activityId?: number; occurredAt?: string; notes?: string | null },
  ) => api.patch<{ id: number; userId: number }>(`/api/presence/activity-logs/${id}`, body),
  deletePresenceActivity: (id: number) =>
    api.delete<{ deleted: true }>(`/api/presence/activity-logs/${id}`),
  stats: () => api.get<LogisticsStats>("/api/logistics/stats"),
  staffScanRanking: () =>
    api.get<{ items: StaffScanRankingRow[] }>("/api/logistics/stats/by-staff"),
  scannableActivities: (category?: "meal" | "activity") =>
    api.get<{ items: ScannableActivity[] }>("/api/activities/scannable", {
      query: category ? { category } : undefined,
    }),
  publicSchedule: () => api.get<{ items: PublicScheduleItem[] }>("/api/public/activities"),
  schedule: () => api.get<{ items: PublicScheduleItem[] }>("/api/schedule"),
  createSchedule: (body: ScheduleInput) =>
    api.post<PublicScheduleItem>("/api/schedule", { ...body }),
  updateSchedule: (id: number, body: Partial<ScheduleInput>) =>
    api.patch<PublicScheduleItem>(`/api/schedule/${id}`, { ...body }),
  deleteSchedule: (id: number) => api.delete<{ deleted: true }>(`/api/schedule/${id}`),
  setScheduleVisibility: (ids: number[], visibility: "shown" | "hidden") =>
    api.post<{ ids: number[]; visibility: "shown" | "hidden"; updated: number }>(
      "/api/schedule/visibility",
      { ids, visibility },
    ),
  setScheduleBulkPublishAt: (ids: number[], publishAt: string | null) =>
    api.post<{ ids: number[]; publishAt: string | null; updated: number }>(
      "/api/schedule/publish-at",
      { ids, publishAt },
    ),
  scheduleOwners: (id: number) =>
    api.get<{ owners: ScheduleOwner[] }>(`/api/schedule/${id}/owners`),
  addScheduleOwner: (id: number, input: { userId: number } | { freeTextName: string }) =>
    api.post<ScheduleOwner>(`/api/schedule/${id}/owners`, input),
  removeScheduleOwner: (id: number, ownerId: number) =>
    api.delete<void>(`/api/schedule/${id}/owners/${ownerId}`),
  scheduleOwnerCandidates: (q: string, limit = 8) =>
    api.get<{
      users: { id: number; email: string; name: string | null; surname: string | null }[];
    }>("/api/schedule/owner-candidates", { query: { q, limit } }),
  activityScan: (
    activityId: number,
    body: { badgeId: string; allowRepeat?: boolean; scannedAt?: string },
  ) =>
    api.post<ActivityScanResult>(`/api/activities/${activityId}/scan`, body, {
      headers: idempotencyHeaders("activity-scan"),
    }),
  mealBatch: (
    activityId: number,
    body: {
      deviceId: string;
      scans: Array<{
        clientScanId: string;
        badgeId: string;
        allowRepeat?: boolean;
        scannedAt?: string;
      }>;
    },
  ) =>
    api.post<MealScanBatchResult>(`/api/activities/${activityId}/meal-scans/batch`, body, {
      headers: idempotencyHeaders("meal-batch"),
    }),
  myTicket: () => api.get<TicketQrPayload>("/api/me/ticket"),
  googleWalletSaveUrl: (purpose: "ticket" | "badge") =>
    api.get<{ saveUrl: string }>(`/api/me/wallet/google/${purpose}`),
  userTicket: (userId: number) => api.get<TicketQrPayload>(`/api/users/${userId}/ticket`),
};

/** Per-account UI preferences (H59) — cross-device sync for things like the schedule table's column config. */
export const uiPrefsApi = {
  get: () => api.get<Record<string, unknown>>("/api/me/ui-prefs"),
  set: (key: string, value: unknown) =>
    api.patch<Record<string, unknown>>("/api/me/ui-prefs", { key, value }),
};

export function personName(card: Pick<PersonCard, "name" | "surname" | "userId">): string {
  return [card.name, card.surname].filter(Boolean).join(" ") || `User #${card.userId}`;
}
