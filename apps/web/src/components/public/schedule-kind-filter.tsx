"use client";

import {
  ACTIVITY_KINDS,
  type ActivityKind,
  DEFAULT_ACTIVITY_KIND,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
import type { PublicScheduleItem } from "@/lib/logistics";

/**
 * The general schedule viewer's activity-kind filter (H59 follow-up,
 * companion to schedule-audience-filter.tsx's audience filter). An item's
 * kind (`item.type`) isn't audience-gated — the API sends it on every item
 * regardless of who's asking — so unlike the audience filter this one's
 * options are derived from `ACTIVITY_KINDS`' display order intersected with
 * what's actually present, not from a caller-specific feed shape.
 */
export function itemActivityKind(item: PublicScheduleItem): ActivityKind {
  return toActivityKind(item.type) ?? DEFAULT_ACTIVITY_KIND;
}

/** Distinct kinds across `items`, in ACTIVITY_KINDS display order. */
export function deriveScheduleKinds(items: readonly PublicScheduleItem[]): ActivityKind[] {
  const present = new Set<ActivityKind>();
  for (const item of items) present.add(itemActivityKind(item));
  return ACTIVITY_KINDS.filter((kind) => present.has(kind));
}

export function matchesScheduleKindFilter(
  item: PublicScheduleItem,
  selected: ReadonlySet<ActivityKind>,
): boolean {
  if (selected.size === 0) return true;
  return selected.has(itemActivityKind(item));
}
