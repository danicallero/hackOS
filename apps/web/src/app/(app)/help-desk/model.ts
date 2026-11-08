import type { MessageKey } from "@/lib/i18n";
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
    mode: "on_my_way" | "meet_at";
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
export const REQUEST_STATUS: Record<HelpRequest["status"], MessageKey> = {
  open: "helpDeskOpen",
  claimed: "helpDeskClaimed",
  resolved: "helpDeskResolved",
  cancelled: "helpDeskCancelled",
};
/** H62: validate the complete replacement before sending any intervals. */
export function validIntervals(intervals: AvailabilityInterval[]): boolean {
  if (intervals.length > 30) return false;
  const sorted = [...intervals].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return sorted.every((item, index) => {
    const start = Date.parse(item.startsAt),
      end = Date.parse(item.endsAt);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      end - start <= 86400000 &&
      (index === 0 || start >= Date.parse(sorted[index - 1].endsAt))
    );
  });
}
