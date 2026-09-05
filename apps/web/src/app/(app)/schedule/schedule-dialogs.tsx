"use client";

import { ACTIVITY_KINDS, type ActivityKind } from "@hackos/shared/activity-kinds";
import { CalendarClockIcon, CalendarPlusIcon, FilterIcon, ListFilterIcon } from "lucide-react";
import { useState } from "react";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import type { PublicScheduleItem, ScheduleAudience } from "@/lib/logistics";
import { SCHEDULE_AUDIENCES, scheduleAudienceLabel, scheduleTypeLabel } from "./schedule-model";

// The Manage Schedule table's popovers and modals (H59): the audience filter,
// the bulk publish-date popover, and the date prompt a row dropped on the
// "new date" strip opens. Extracted from page.tsx, which the page-size ratchet
// keeps to the page itself.

export function AudienceFilterPopover({
  selected,
  staffOnly,
  onChange,
}: {
  selected: Set<ScheduleAudience>;
  staffOnly: boolean;
  onChange: (selected: Set<ScheduleAudience>, staffOnly: boolean) => void;
}) {
  const { t } = useLocale();
  const activeCount = selected.size + (staffOnly ? 1 : 0);

  function toggleAudience(audience: ScheduleAudience, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(audience);
    else next.delete(audience);
    onChange(next, staffOnly);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon className="size-4" />
          {t("audienceFilterAction")}
          {activeCount > 0 && (
            <span className="bg-primary text-primary-foreground ml-0.5 flex size-4 items-center justify-center rounded-full text-[10px]">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 space-y-1">
        {SCHEDULE_AUDIENCES.map((audience) => (
          <div key={audience} className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              id={`audience-filter-${audience}`}
              checked={selected.has(audience)}
              onCheckedChange={(checked) => toggleAudience(audience, checked === true)}
            />
            <label htmlFor={`audience-filter-${audience}`} className="flex-1 text-sm">
              {scheduleAudienceLabel(audience, t)}
            </label>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2 border-t px-1 pt-2">
          <Checkbox
            id="audience-filter-staff-only"
            checked={staffOnly}
            onCheckedChange={(checked) => onChange(selected, checked === true)}
          />
          <label htmlFor="audience-filter-staff-only" className="flex-1 text-sm">
            {t("audienceFilterStaffOnly")}
          </label>
        </div>
        {activeCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onChange(new Set(), false)}
          >
            {t("clearFilters")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function KindFilterPopover({
  selected,
  onChange,
}: {
  selected: Set<ActivityKind>;
  onChange: (selected: Set<ActivityKind>) => void;
}) {
  const { t } = useLocale();

  function toggleKind(kind: ActivityKind, checked: boolean) {
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
      <PopoverContent align="end" className="w-60 space-y-1">
        {ACTIVITY_KINDS.map((kind) => (
          <div key={kind} className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              id={`kind-filter-${kind}`}
              checked={selected.has(kind)}
              onCheckedChange={(checked) => toggleKind(kind, checked === true)}
            />
            <label htmlFor={`kind-filter-${kind}`} className="flex-1 text-sm">
              {scheduleTypeLabel(kind, t)}
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

export function MoveToDateModal({
  item,
  onOpenChange,
  onConfirm,
}: {
  item: PublicScheduleItem;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetDate: string) => Promise<void>;
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(() => toDatetimeLocal(item.startsAt).slice(0, 10));
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (!value) return;
    setPending(true);
    try {
      await onConfirm(value);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={t("moveToDateTitle")}
      icon={CalendarPlusIcon}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <SubmitButton pending={pending} onClick={confirm} disabled={!value}>
            {t("moveAction")}
          </SubmitButton>
        </>
      }
    >
      <div className="space-y-2">
        <label htmlFor="move-to-date" className="text-sm font-medium">
          {t("moveToDateLabel")}
        </label>
        <DateTimeInput id="move-to-date" type="date" value={value} onChange={setValue} />
      </div>
    </Modal>
  );
}

export function BulkSchedulePopover({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (publishAt: string | null) => Promise<void>;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <CalendarClockIcon className="size-4" />
          {t("bulkScheduleAction")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-muted-foreground text-sm text-pretty">{t("bulkScheduleHint")}</p>
        <DateTimeInput id="bulk-schedule-publish-at" value={value} onChange={setValue} />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!value}
            onClick={async () => {
              await onApply(new Date(value).toISOString());
              setOpen(false);
              setValue("");
            }}
          >
            {t("applyAction")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Day-section header row — also the drop target a dragged row lands on to move to that day. */
