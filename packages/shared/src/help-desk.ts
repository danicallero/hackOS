/**
 * Help desk client model (H61-H67), shared by web and mobile so both read the
 * same API shapes and apply the same pre-submit checks the API enforces.
 */
export interface HelpTopic {
  id: number;
  name: string;
}
export interface AvailabilityInterval {
  startsAt: string;
  endsAt: string;
}
export interface HelperCard {
  userId: number;
  displayName: string;
  photoUrl: string | null;
  headline: string | null;
  bio: string | null;
  kind: "mentor" | "sponsor" | "staff";
  /** H8: highest assigned visible role, as on the badge; null when none is visible. */
  visibleRoleName: string | null;
  affiliation: string | null;
  affiliationLogoUrl: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  scheduledNow: boolean;
  present: boolean;
  availableNow: boolean;
}
export interface MyHelperProfile<P = unknown> {
  eligible: boolean;
  published: boolean;
  publishedAt: string | null;
  bio: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  suggestedInterval: AvailabilityInterval | null;
  /** Challenges whose requests this helper is alerted to; empty means every request. */
  challengeIds: number[];
  /** The selected challenges, named (same order as `challengeIds`). */
  challenges: { id: number; name: string }[];
  /** Every challenge of the event the helper may choose from. */
  challengeOptions: { id: number; name: string }[];
  preview: HelperDetail<P>;
}
export interface HelpChallengeOption {
  id: number;
  name: string;
  mine: boolean;
}
export type MeetingMode = "on_my_way" | "meet_at";
export interface HelpRequest {
  id: number;
  status: "open" | "claimed" | "resolved" | "cancelled";
  description: string;
  location: string;
  topics: HelpTopic[];
  other: boolean;
  challenge: { id: number; name: string } | null;
  preferSponsor: boolean;
  project: { id: number; name: string } | null;
  requester: { userId: number; displayName: string } | null;
  routing: "matched" | "fallback" | "sponsor" | "none";
  notifiedCount: number;
  claim: null | {
    helper: Pick<
      HelperCard,
      "userId" | "displayName" | "photoUrl" | "kind" | "affiliation" | "visibleRoleName"
    > | null;
    mode: MeetingMode;
    meetingLocation: string | null;
    claimedAt: string;
  };
  createdAt: string;
  /** First-come, first-served ordering key; editing an open request moves it to the end. */
  queuedAt: string;
  /** 1-based among all open requests; null once claimed or closed. */
  queuePosition: number | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  viewer: {
    canCancel: boolean;
    canEdit: boolean;
    canClaim: boolean;
    canRelease: boolean;
    canResolve: boolean;
    notified: boolean;
  };
}
export interface CoverageReport {
  from: string;
  to: string;
  stepMinutes: number;
  totals: { publishedHelpers: number; byKind: Record<HelperCard["kind"], number> };
  slots: {
    startsAt: string;
    endsAt: string;
    scheduled: number;
    byKind: Record<HelperCard["kind"], number>;
    topics: (HelpTopic & { scheduled: number })[];
  }[];
  now: {
    at: string;
    scheduled: number;
    present: number;
    available: number;
    topics: (HelpTopic & { scheduled: number; available: number })[];
  };
  uncoveredTopics: HelpTopic[];
}

/** `GET /api/helpdesk/requests/:id`: the request plus the requester's public profile `P` (directory entry) when the viewer may see it, else null. */
export type HelpRequestDetail<P> = HelpRequest & { requesterProfile: P | null };

/** A published helper as the detail route returns it: the card plus the person's public profile `P`. */
export type HelperDetail<P> = HelperCard & {
  profile: P;
  /** Challenges this helper limited their alerts to; empty means every request. */
  challenges: { id: number; name: string }[];
};

export const MAX_AVAILABILITY_INTERVALS = 30;
export const MAX_INTERVAL_MS = 86_400_000;

/** H62: validate the complete replacement before sending any intervals. */
export function validAvailability(intervals: AvailabilityInterval[]): boolean {
  if (intervals.length > MAX_AVAILABILITY_INTERVALS) return false;
  const sorted = [...intervals].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return sorted.every((item, index) => {
    const previous = sorted[index - 1];
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      end - start <= MAX_INTERVAL_MS &&
      (!previous || Date.parse(previous.endsAt) <= start)
    );
  });
}

/** H64: the same limits the request route validates. */
export function validHelpRequest(
  description: string,
  location: string,
  topics: HelpTopic[],
  other: boolean,
): boolean {
  const need = description.trim().length;
  const place = location.trim().length;
  return (
    need > 0 &&
    need <= 500 &&
    place > 0 &&
    place <= 120 &&
    topics.length <= 5 &&
    (topics.length > 0 || other)
  );
}

export type CoverageSlot = CoverageReport["slots"][number];
export interface CoverageRun {
  startsAt: string;
  endsAt: string;
  scheduled: number;
  topics: HelpTopic[];
}
export interface CoverageDay {
  key: string;
  runs: CoverageRun[];
}

/**
 * H67: slots grouped by day (`dayKey`, e.g. the event-zone date), merging
 * consecutive slots with the same helper count and topics into one run, so a
 * day reads "09:00–13:00 · 2 helpers · Frontend" and gaps stand out as runs
 * with nobody scheduled instead of a wall of identical hourly rows.
 */
export function coverageDays(
  slots: CoverageSlot[],
  dayKey: (iso: string) => string,
): CoverageDay[] {
  const days: CoverageDay[] = [];
  for (const slot of slots) {
    const key = dayKey(slot.startsAt);
    let day = days[days.length - 1];
    if (day?.key !== key) {
      day = { key, runs: [] };
      days.push(day);
    }
    const topics = slot.topics.map(({ id, name }) => ({ id, name }));
    const signature = topics.map((topic) => topic.id).join(",");
    const last = day.runs[day.runs.length - 1];
    if (
      last &&
      Date.parse(last.endsAt) === Date.parse(slot.startsAt) &&
      last.scheduled === slot.scheduled &&
      last.topics.map((topic) => topic.id).join(",") === signature
    ) {
      last.endsAt = slot.endsAt;
    } else {
      day.runs.push({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        scheduled: slot.scheduled,
        topics,
      });
    }
  }
  return days;
}

/**
 * H64: when the help desk accepts new requests. `windows` are the opening
 * periods an admin set (continuous from start to end); none configured means
 * always open (`configured: false`). Closed only disables creating requests:
 * claims, resolution, browsing and helper settings keep working.
 */
export interface HelpdeskSchedule {
  configured: boolean;
  open: boolean;
  windows: AvailabilityInterval[];
  /** The next instant `open` flips, or null when it never will. */
  nextChangeAt: string | null;
  /** Prefill for a new window: the hacking window, else the event window, else null. */
  suggestedInterval: AvailabilityInterval | null;
}
