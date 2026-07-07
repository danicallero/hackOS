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
  confirmed: boolean;
  hasTicket: boolean;
  alreadyAccredited: boolean;
  currentBadge: string | null;
}

export interface CheckInResult {
  userId: number;
  badgeId: string;
  method: "qr" | "manual" | "nfc";
  checkInLogId: number;
  checkedInAt: string;
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

export interface PresenceHours {
  userId: number;
  hours: number;
  intervals?: { start: string; end: string }[];
}

export interface ActivityScanResult {
  registered: boolean;
  firstTime: boolean;
  repeat: boolean;
  timesEaten: number;
  card: PersonCard;
  message?: string;
}

export interface LogisticsStats {
  accreditedCount: number;
  currentlyPresent: number;
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

export interface PublicScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
  publishAt: string | null;
}

export interface MealScanBatchResult {
  batchId: number;
  accepted: number;
  duplicate: number;
  queued: boolean;
}

export function idempotencyHeaders(prefix: string): Record<string, string> {
  return { "idempotency-key": `${prefix}-${crypto.randomUUID()}` };
}

export const logisticsApi = {
  lookup: (ticketToken: string) =>
    api.post<AccreditationLookup>("/api/accreditation/lookup", { ticketToken }),
  checkIn: (body: { ticketToken: string; badgeId: string; method: "qr" | "manual" | "nfc" }) =>
    api.post<CheckInResult>("/api/accreditation/check-in", body, {
      headers: idempotencyHeaders("check-in"),
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
  presenceScan: (body: {
    badgeId: string;
    kind: "in" | "out";
    location?: string;
    scannedAt?: string;
  }) =>
    api.post("/api/presence/scan", body, {
      headers: idempotencyHeaders("presence"),
    }),
  presenceEstimate: () => api.get<PresenceEstimate>("/api/presence/estimate"),
  presenceHours: () => api.get<PresenceHours[]>("/api/presence/hours"),
  stats: () => api.get<LogisticsStats>("/api/logistics/stats"),
  publicSchedule: () => api.get<{ items: PublicScheduleItem[] }>("/api/public/activities"),
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
  grantEntitlement: (activityId: number, userId: number) =>
    api.post(`/api/activities/${activityId}/entitlements`, { userId }),
  revokeEntitlement: (activityId: number, userId: number) =>
    api.delete(`/api/activities/${activityId}/entitlements/${userId}`),
  bulkGrantConfirmed: (activityId: number) =>
    api.post<{ activityId: number; granted: number }>(
      `/api/activities/${activityId}/entitlements/bulk-grant-confirmed`,
    ),
};

export function personName(card: Pick<PersonCard, "name" | "surname" | "userId">): string {
  return [card.name, card.surname].filter(Boolean).join(" ") || `User #${card.userId}`;
}
