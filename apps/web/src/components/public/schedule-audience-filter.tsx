"use client";

import type { Translate } from "@/lib/i18n";
import type { PublicScheduleItem, ScheduleAudience } from "@/lib/logistics";

/**
 * The general schedule viewer's own audience filter (H59 follow-up), distinct
 * from the Manage Schedule table's `ScheduleFilterMenu` (schedule/
 * schedule-dialogs.tsx), which filters an *editor's* view while managing
 * every item including drafts. This one narrows what a viewer already
 * received from /api/public/activities — the API only ever sends items a
 * caller is entitled to see (`callerScheduleAudiences`/
 * `listScheduleForAudiences`), so the segments worth offering are exactly the
 * caller-visible tags actually present across the items they got back: no
 * separate capability/role lookup is needed, and it can never offer a segment
 * the viewer doesn't already have access to. The API strips non-applicable
 * tags from non-staff responses, which keeps a participant-only feed at the
 * participant segment even when an item is also aimed at mentors.
 *
 * An item with no `audiences` tags is staff-only (schedule.ts's
 * `ScheduleAudience` doc comment) — only a staff caller's feed ever includes
 * one, so its presence alone is what makes the "staff" segment appear here.
 */
export type ViewerScheduleSegment = "staff" | ScheduleAudience;

const SEGMENT_ORDER: ViewerScheduleSegment[] = ["staff", "sponsor", "participant", "mentor"];

export function itemScheduleSegments(item: PublicScheduleItem): ViewerScheduleSegment[] {
  return item.audiences && item.audiences.length > 0 ? item.audiences : ["staff"];
}

/** Distinct segments across `items`, in a stable display order. */
export function deriveViewerScheduleSegments(
  items: readonly PublicScheduleItem[],
): ViewerScheduleSegment[] {
  const present = new Set<ViewerScheduleSegment>();
  for (const item of items) {
    if (item.visibility !== undefined) present.add("staff");
    for (const segment of itemScheduleSegments(item)) present.add(segment);
  }
  return SEGMENT_ORDER.filter((segment) => present.has(segment));
}

export function matchesScheduleSegmentFilter(
  item: PublicScheduleItem,
  selected: ReadonlySet<ViewerScheduleSegment>,
): boolean {
  if (selected.size === 0) return true;
  return itemScheduleSegments(item).some((segment) => selected.has(segment));
}

export function segmentLabel(segment: ViewerScheduleSegment, t: Translate): string {
  if (segment === "staff") return t("audienceFilterStaffOnly");
  const labels: Record<ScheduleAudience, string> = {
    sponsor: t("audienceSponsor"),
    participant: t("audienceParticipant"),
    mentor: t("audienceMentor"),
  };
  return labels[segment];
}
