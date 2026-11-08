import { apiFetch } from "./api";
import { canUseHelpDesk } from "./tabs";

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
  affiliation: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  scheduledNow: boolean;
  present: boolean;
  availableNow: boolean;
}
export interface MyHelperProfile {
  eligible: boolean;
  published: boolean;
  publishedAt: string | null;
  bio: string | null;
  topics: HelpTopic[];
  availability: AvailabilityInterval[];
  preview: HelperCard;
}
export type MeetingMode = "on_my_way" | "meet_at";
export interface HelpRequest {
  id: number;
  status: "open" | "claimed" | "resolved" | "cancelled";
  description: string;
  location: string;
  topics: HelpTopic[];
  other: boolean;
  project: { id: number; name: string } | null;
  requester: { userId: number; displayName: string } | null;
  routing: "matched" | "fallback" | "none";
  notifiedCount: number;
  claim: null | {
    helper: Pick<HelperCard, "userId" | "displayName" | "photoUrl" | "kind" | "affiliation"> | null;
    mode: MeetingMode;
    meetingLocation: string | null;
    claimedAt: string;
  };
  createdAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
  viewer: {
    canCancel: boolean;
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
    topics: { id: number; name: string; scheduled: number }[];
  }[];
  now: {
    at: string;
    scheduled: number;
    present: number;
    available: number;
    topics: { id: number; name: string; scheduled: number; available: number }[];
  };
  uncoveredTopics: HelpTopic[];
}
export const canBrowseHelpDesk = canUseHelpDesk;
export function helpMutation<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  return apiFetch<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
/** H62: validate before replacing the schedule, preserving the editor on errors. */
export function validAvailability(intervals: AvailabilityInterval[]): boolean {
  if (intervals.length > 30) return false;
  const sorted = [...intervals].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return sorted.every((item, index) => {
    const start = Date.parse(item.startsAt);
    const end = Date.parse(item.endsAt);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      end - start <= 86_400_000 &&
      (index === 0 || Date.parse(sorted[index - 1].endsAt) <= start)
    );
  });
}
export function validHelpRequest(
  description: string,
  location: string,
  topics: HelpTopic[],
  other: boolean,
) {
  return (
    description.trim().length > 0 &&
    description.trim().length <= 500 &&
    location.trim().length > 0 &&
    location.trim().length <= 120 &&
    topics.length <= 5 &&
    (topics.length > 0 || other)
  );
}
