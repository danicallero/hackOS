"use client";

import {
  ACTIVITY_KINDS,
  type ActivityKind,
  activityKindLabelKey,
  DEFAULT_ACTIVITY_KIND,
  toActivityKind,
} from "@hackos/shared/activity-kinds";
import { ListFilterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Translate } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";
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

function kindLabel(kind: ActivityKind, t: Translate): string {
  return t(activityKindLabelKey(kind));
}

export function ScheduleKindFilterPopover({
  kinds,
  selected,
  onChange,
}: {
  /** The viewer's own filterable universe — see deriveScheduleKinds. */
  kinds: ActivityKind[];
  selected: Set<ActivityKind>;
  onChange: (selected: Set<ActivityKind>) => void;
}) {
  const { t } = useLocale();

  function toggle(kind: ActivityKind, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(kind);
    else next.delete(kind);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilterIcon className="size-4" />
          {t("kindFilterAction")}
          {selected.size > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 flex size-4 items-center justify-center rounded-full text-[10px]">
              {selected.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 space-y-1">
        {kinds.map((kind) => (
          <div key={kind} className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              id={`schedule-kind-filter-${kind}`}
              checked={selected.has(kind)}
              onCheckedChange={(checked) => toggle(kind, checked === true)}
            />
            <label htmlFor={`schedule-kind-filter-${kind}`} className="flex-1 text-sm">
              {kindLabel(kind, t)}
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
