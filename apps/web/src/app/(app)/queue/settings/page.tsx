"use client";

// Judging window (QUEUE_ADMIN): the window that sizes room pace (H39) — a
// separate resource (queue_settings) from event_config, so it lives in the
// Live Judging workspace next to rooms/reviews rather than in Event
// Settings, where it was only ever visually co-located before. Previews the
// live phase and total window duration; the actual per-team minutes budget
// is computed per room on the queue workspace, not editable from here.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { GavelIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { DateTimeInput } from "@/components/common/datetime-input";
import { PageHeader } from "@/components/common/page-header";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ApiError } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { fromLocalInputValue } from "@/lib/event-datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { getQueueSettings, type QueueSettings, updateQueueSettings } from "@/lib/queue";
import type { SaveState } from "@/lib/save-state";
import { useCan } from "@/lib/session";

const schema = z.object({
  judgingStartsAt: z.string(),
  judgingEndsAt: z.string(),
});

type Values = z.infer<typeof schema>;

function fromSettings(settings: QueueSettings): Values {
  return {
    judgingStartsAt: toDatetimeLocal(settings.schedule_start_at),
    judgingEndsAt: toDatetimeLocal(settings.schedule_end_at),
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
      <p className="text-muted-foreground mb-2 text-xs uppercase">{t("judgingPacePreviewLabel")}</p>
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

export default function JudgingWindowSettingsPage() {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.QUEUE_ADMIN);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { judgingStartsAt: "", judgingEndsAt: "" },
  });
  const { reset, formState, watch } = form;

  useEffect(() => {
    getQueueSettings()
      .then((settings) => {
        reset(fromSettings(settings));
        setLoaded(true);
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadJudgingWindow")),
      );
  }, [reset, t]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await updateQueueSettings({
        scheduleStartAt: fromDatetimeLocal(values.judgingStartsAt),
        scheduleEndAt: fromDatetimeLocal(values.judgingEndsAt),
      });
      reset(fromSettings(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveJudgingWindow"));
    }
  }

  const values = watch();

  if (!canManage) {
    return <AccessDenied ask={t("judgingWindowDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("judgingWindowTitle")} />
      {!loaded ? null : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <SectionCard
              icon={GavelIcon}
              title={t("judgingWindowTitle")}
              description={t("judgingWindowDesc")}
              state={<SaveStatus state={formState.isSubmitting ? "saving" : saveState} />}
              footer={
                <SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
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
              <PacePreview startsAt={values.judgingStartsAt} endsAt={values.judgingEndsAt} />
            </SectionCard>
          </form>
        </Form>
      )}
    </div>
  );
}
