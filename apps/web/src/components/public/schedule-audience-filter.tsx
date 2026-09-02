"use client";

import { FilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Translate } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";
import type { PublicScheduleItem, ScheduleAudience } from "@/lib/logistics";

/**
 * The general schedule viewer's own audience filter (H59 follow-up), distinct
 * from the Manage Schedule table's `AudienceFilterPopover` (schedule/
 * schedule-dialogs.tsx), which filters an *editor's* view while managing
 * every item including drafts. This one narrows what a viewer already
 * received from /api/public/activities — the API only ever sends items a
 * caller is entitled to see (`callerScheduleAudiences`/
 * `listScheduleForAudiences`), so the segments worth offering are exactly the
 * ones actually present across the items they got back: no separate
 * capability/role lookup needed, and it can never offer a segment the viewer
 * doesn't already have access to.
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

function segmentLabel(segment: ViewerScheduleSegment, t: Translate): string {
  if (segment === "staff") return t("audienceFilterStaffOnly");
  const labels: Record<ScheduleAudience, string> = {
    sponsor: t("audienceSponsor"),
    participant: t("audienceParticipant"),
    mentor: t("audienceMentor"),
  };
  return labels[segment];
}

export function ScheduleAudienceFilterPopover({
  segments,
  selected,
  onChange,
}: {
  /** The viewer's own filterable universe — see deriveViewerScheduleSegments. */
  segments: ViewerScheduleSegment[];
  selected: Set<ViewerScheduleSegment>;
  onChange: (selected: Set<ViewerScheduleSegment>) => void;
}) {
  const { t } = useLocale();

  function toggle(segment: ViewerScheduleSegment, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(segment);
    else next.delete(segment);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon className="size-4" />
          {t("audienceFilterAction")}
          {selected.size > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 flex size-4 items-center justify-center rounded-full text-[10px]">
              {selected.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-1">
        {segments.map((segment) => (
          <div key={segment} className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              id={`schedule-segment-filter-${segment}`}
              checked={selected.has(segment)}
              onCheckedChange={(checked) => toggle(segment, checked === true)}
            />
            <label htmlFor={`schedule-segment-filter-${segment}`} className="flex-1 text-sm">
              {segmentLabel(segment, t)}
            </label>
          </div>
        ))}
        {selected.size > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onChange(new Set())}
          >
            {t("clearFilters")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
