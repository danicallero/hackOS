"use client";
import { instantToWallClock, wallClockToInstant } from "@hackos/shared/event-time";
import { useId, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiErrorText } from "@/lib/api-error-text";
import { useEventTimeZone, useEventZoneHint } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import type { AvailabilityInterval } from "./model";

/**
 * The From / To dialog shared by the stated availability (H62) and the help
 * desk opening hours (H64): two event-zone date-times prefilled from `initial`,
 * the order check, the caller's own rule (`validate`, returning the message to
 * show or null) and an optional muted summary. Saving hands back the instants.
 */
export function IntervalDialog({
  title,
  submitLabel,
  initial,
  incompleteMessage,
  validate,
  summary,
  pending,
  error,
  onClose,
  onSave,
}: {
  title: string;
  submitLabel: string;
  initial: AvailabilityInterval | null;
  incompleteMessage: string;
  validate: (interval: AvailabilityInterval) => string | null;
  summary?: (interval: AvailabilityInterval) => string | null;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (interval: AvailabilityInterval) => void;
}) {
  const { t, language } = useLocale();
  const id = useId();
  const zone = useEventTimeZone();
  const zoneHint = useEventZoneHint(language);
  const [from, setFrom] = useState(() =>
    instantToWallClock(initial?.startsAt ?? "", zone).slice(0, 16),
  );
  const [to, setTo] = useState(() => instantToWallClock(initial?.endsAt ?? "", zone).slice(0, 16));
  const [submitted, setSubmitted] = useState(false);
  const startsAt = from ? wallClockToInstant(from, zone) : null;
  const endsAt = to ? wallClockToInstant(to, zone) : null;
  const ordered = !!startsAt && !!endsAt && Date.parse(endsAt) > Date.parse(startsAt);
  const interval = startsAt && endsAt && ordered ? { startsAt, endsAt } : null;
  const problem = interval ? validate(interval) : null;
  const message =
    !startsAt || !endsAt
      ? submitted
        ? incompleteMessage
        : null
      : !ordered
        ? t("helpDeskIntervalOrder")
        : problem;
  const note = interval && !problem ? (summary?.(interval) ?? null) : null;
  return (
    <Modal
      open
      size="sm"
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title={title}
    >
      <form
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // The dialog renders inside the caller's form React tree.
          event.stopPropagation();
          setSubmitted(true);
          if (interval && !message) onSave(interval);
        }}
      >
        <fieldset disabled={pending} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-from`}>{t("helpDeskFrom")}</Label>
            <DateTimeInput
              id={`${id}-from`}
              type="datetime-local"
              value={from}
              onChange={setFrom}
              aria-describedby={`${id}-status`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-to`}>{t("helpDeskTo")}</Label>
            <DateTimeInput
              id={`${id}-to`}
              type="datetime-local"
              value={to}
              onChange={setTo}
              aria-describedby={`${id}-status`}
            />
          </div>
          <p
            id={`${id}-status`}
            role={message ? "alert" : undefined}
            className={message ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {message ?? [note, zoneHint].filter(Boolean).join(" · ")}
          </p>
        </fieldset>
        {error ? (
          <ContextualError message={apiErrorText(error, t, t("helpDeskSaveError"))} />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={pending} disabled={!!message && !!startsAt && !!endsAt}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
