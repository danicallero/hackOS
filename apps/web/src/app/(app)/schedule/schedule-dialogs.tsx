"use client";

import { ACTIVITY_KINDS, type ActivityKind } from "@hackos/shared/activity-kinds";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CalendarPlusIcon } from "@phosphor-icons/react/dist/csr/CalendarPlus";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { useState } from "react";
import { DateTimeInput } from "@/components/common/datetime-input";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { Modal } from "@/components/common/modal";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import type { PublicScheduleItem, ScheduleAudience } from "@/lib/logistics";
import { SCHEDULE_AUDIENCES, scheduleAudienceLabel, scheduleTypeLabel } from "./schedule-model";

// The Manage Schedule table's popovers and modals (H59): the audience filter,
// the bulk publish-date popover, and the date prompt a row dropped on the
// "new date" strip opens. Extracted from page.tsx, which the page-size ratchet
// keeps to the page itself.

export function useScheduleFilters({
  audiences,
  staffOnly,
  kinds,
  onAudienceChange,
  onKindChange,
}: {
  audiences: Set<ScheduleAudience>;
  staffOnly: boolean;
  kinds: Set<ActivityKind>;
  onAudienceChange: (selected: Set<ScheduleAudience>, staffOnly: boolean) => void;
  onKindChange: (selected: Set<ActivityKind>) => void;
}) {
  const { t } = useLocale();
  return [
    {
      id: "audience",
      label: t("audienceFilterAction"),
      icon: UsersIcon,
      type: "multiple",
      value: [...audiences, ...(staffOnly ? ["staffOnly"] : [])],
      onChange: (values) =>
        onAudienceChange(
          new Set(SCHEDULE_AUDIENCES.filter((audience) => values.includes(audience))),
          values.includes("staffOnly"),
        ),
      options: [
        ...SCHEDULE_AUDIENCES.map((audience) => ({
          value: audience,
          label: scheduleAudienceLabel(audience, t),
        })),
        { value: "staffOnly", label: t("audienceFilterStaffOnly") },
      ],
    },
    {
      id: "kind",
      label: t("kindFilterAction"),
      icon: FunnelSimpleIcon,
      type: "multiple",
      value: [...kinds],
      onChange: (values) =>
        onKindChange(new Set(ACTIVITY_KINDS.filter((kind) => values.includes(kind)))),
      options: ACTIVITY_KINDS.map((kind) => ({
        value: kind,
        label: scheduleTypeLabel(kind, t),
      })),
    },
  ] satisfies FilterDefinition[];
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
          <CalendarDotsIcon aria-hidden="true" className="size-4" />
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
