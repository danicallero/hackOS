"use client";

// H39: event-wide judging hours; access is gated by QUEUE_ADMIN in Event settings.

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { apiErrorText } from "@/lib/api-error-text";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { fromLocalInputValue } from "@/lib/event-datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { getQueueSettings, type QueueSettings, updateQueueSettings } from "@/lib/queue";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";

// Pre-call and called-too-long minutes (H38, H34): the automatic "you're up
// soon" notification and the staff warning, edited next to the judging hours.
const PRE_CALL_RANGE = { min: 0, max: 240 };
const CALLED_TOO_LONG_RANGE = { min: 1, max: 240 };

const inRange = (value: string, { min, max }: { min: number; max: number }) =>
  /^\d+$/.test(value) && Number(value) >= min && Number(value) <= max;

const schema = z.object({
  judgingStartsAt: z.string(),
  judgingEndsAt: z.string(),
  preCallMinutes: z.string().refine((v) => inRange(v, PRE_CALL_RANGE), "range"),
  calledTooLongMinutes: z.string().refine((v) => inRange(v, CALLED_TOO_LONG_RANGE), "range"),
});

type Values = z.infer<typeof schema>;

function fromSettings(settings: QueueSettings): Values {
  return {
    judgingStartsAt: toDatetimeLocal(settings.schedule_start_at),
    judgingEndsAt: toDatetimeLocal(settings.schedule_end_at),
    preCallMinutes: String(settings.pre_call_notification_eta_minutes),
    calledTooLongMinutes: String(settings.called_too_long_threshold_minutes),
  };
}

function formatDuration(ms: number, t: Translate): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return t("durationMinutes", { minutes });
  if (minutes === 0) return t("durationHours", { hours });
  return t("durationHoursMinutes", { hours, minutes });
}

function PacePreview({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const start = fromLocalInputValue(startsAt);
  const end = fromLocalInputValue(endsAt);

  return (
    <div className="rounded-lg border p-4">
      {!start || !end ? (
        <p className="text-muted-foreground text-sm">{t("judgingWindowUnsetDesc")}</p>
      ) : (
        (() => {
          const startMs = new Date(start).getTime();
          const endMs = new Date(end).getTime();
          if (endMs <= startMs)
            return <p className="text-destructive text-sm">{t("mustBeAfterStartTime")}</p>;
          if (now < startMs) {
            return (
              <p className="text-sm">
                {t("judgingPaceStartsIn", { duration: formatDuration(startMs - now, t) })}
              </p>
            );
          }
          if (now < endMs) {
            return (
              <p className="text-sm">
                {t("judgingPaceRemaining", { duration: formatDuration(endMs - now, t) })}
              </p>
            );
          }
          return <p className="text-muted-foreground text-sm">{t("judgingPaceEnded")}</p>;
        })()
      )}
      {start && end && (
        <p className="text-muted-foreground mt-2 text-xs">
          {t("judgingPaceTotalWindow", {
            duration: formatDuration(new Date(end).getTime() - new Date(start).getTime(), t),
          })}
        </p>
      )}
    </div>
  );
}

function MinutesField({
  control,
  name,
  label,
  range,
}: {
  control: Control<Values>;
  name: "preCallMinutes" | "calledTooLongMinutes";
  label: string;
  range: { min: number; max: number };
}) {
  const { t } = useLocale();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              {...field}
              type="number"
              inputMode="numeric"
              min={range.min}
              max={range.max}
              className="w-24"
            />
          </FormControl>
          {fieldState.error && (
            <p role="alert" className="text-destructive text-sm">
              {t("timingRangeError", range)}
            </p>
          )}
        </FormItem>
      )}
    />
  );
}

export function JudgingWindowTab({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema),
    defaultValues: {
      judgingStartsAt: "",
      judgingEndsAt: "",
      preCallMinutes: "10",
      calledTooLongMinutes: "10",
    },
  });
  const { reset, formState } = form;

  useEffect(() => {
    getQueueSettings()
      .then((settings) => {
        reset(fromSettings(settings));
        setLoaded(true);
      })
      .catch((err) =>
        toast.error(apiErrorText(err, t, t("couldNotLoadJudgingWindow")), t("toastJudgingHours")),
      );
  }, [reset, t]);

  useEffect(() => {
    onDirtyChange?.(formState.isDirty);
    return () => onDirtyChange?.(false);
  }, [formState.isDirty, onDirtyChange]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await updateQueueSettings({
        scheduleStartAt: fromDatetimeLocal(values.judgingStartsAt),
        scheduleEndAt: fromDatetimeLocal(values.judgingEndsAt),
        preCallNotificationEtaMinutes: Number(values.preCallMinutes),
        calledTooLongThresholdMinutes: Number(values.calledTooLongMinutes),
      });
      reset(fromSettings(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(apiErrorText(err, t, t("couldNotSaveJudgingWindow")), t("toastJudgingHours"));
    }
  }

  const values = useWatch({ control: form.control });

  if (!loaded) return null;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
        <SectionCard
          variant="plain"
          footer={
            <FormActions
              pending={formState.isSubmitting}
              state={saveState === "error" ? "error" : formState.isDirty ? "unsaved" : saveState}
            />
          }
        >
          <FormField
            control={form.control}
            name="judgingStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judgingStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="judgingEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("judgingEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <MinutesField
            control={form.control}
            name="preCallMinutes"
            label={t("judgingPreCallMinutes")}
            range={PRE_CALL_RANGE}
          />
          <MinutesField
            control={form.control}
            name="calledTooLongMinutes"
            label={t("judgingCalledTooLongMinutes")}
            range={CALLED_TOO_LONG_RANGE}
          />
          <PacePreview
            startsAt={values.judgingStartsAt ?? ""}
            endsAt={values.judgingEndsAt ?? ""}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
