"use client";

// Schedule category: doors-open/event window and the hacking window that
// drives the public countdown (H47, H49) and TV panels (H42). Each
// date/time field shows both the browser-local instant being edited and its
// event-timezone reading, and the section previews exactly what the public
// countdown will show once saved (H45's "reveal, no manual toggling" idea
// applied to the countdown handoff) by reusing the same phase logic the
// public site and TV run.

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { EventPhaseDisplay, useEventPhase } from "@/components/public/timer";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/event-datetime";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";
import { ZonedTimePreview } from "./zoned-time-preview";

const schema = z.object({
  eventStartsAt: z.string(),
  eventEndsAt: z.string(),
  hackingStartsAt: z.string(),
  hackingEndsAt: z.string(),
  showStartCountdown: z.boolean(),
});

type Values = z.infer<typeof schema>;

function fromConfig(cfg: EventConfig): Values {
  return {
    eventStartsAt: toLocalInputValue(cfg.eventStartsAt),
    eventEndsAt: toLocalInputValue(cfg.eventEndsAt),
    hackingStartsAt: toLocalInputValue(cfg.hackingStartsAt),
    hackingEndsAt: toLocalInputValue(cfg.hackingEndsAt),
    showStartCountdown: cfg.showStartCountdown,
  };
}

function CountdownPreview({
  values,
  judgingStartsAt,
  judgingEndsAt,
}: {
  values: Values;
  judgingStartsAt: string | null;
  judgingEndsAt: string | null;
}) {
  const { t } = useLocale();
  const phase = useEventPhase({
    name: null,
    tagline: null,
    timezone: "",
    hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
    hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
    showStartCountdown: values.showStartCountdown,
    judgingStartsAt,
    judgingEndsAt,
  });

  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        {t("publicPreviewLabel")}
      </p>
      {phase.kind === "none" ? (
        <p className="text-muted-foreground text-sm">{t("countdownPreviewEmpty")}</p>
      ) : (
        <EventPhaseDisplay phase={phase} className="type-page-title tabular-nums" />
      )}
    </div>
  );
}

export function ScheduleTab({
  icon,
  onDirtyChange,
}: {
  icon: LucideIcon;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { config, status, applyConfig } = useEventConfig();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      eventStartsAt: "",
      eventEndsAt: "",
      hackingStartsAt: "",
      hackingEndsAt: "",
      showStartCountdown: false,
    },
  });
  const { reset, formState, watch } = form;
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, onDirtyChange);

  useEffect(() => {
    if (config) reset(fromConfig(config));
  }, [config, reset]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        eventStartsAt: fromLocalInputValue(values.eventStartsAt),
        eventEndsAt: fromLocalInputValue(values.eventEndsAt),
        hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
        hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
        showStartCountdown: values.showStartCountdown,
      });
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("scheduleSectionTitle")} />;
  }
  const timezone = config.timezone;
  const values = watch();

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard
          icon={icon}
          title={t("scheduleSectionTitle")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
          <FormField
            control={form.control}
            name="eventStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("eventStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <ZonedTimePreview value={field.value} timezone={timezone} />
                <FormDescription>{t("eventStartsDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="eventEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("eventEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <ZonedTimePreview value={field.value} timezone={timezone} />
                <FormDescription>{t("eventEndsDesc")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hackingStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hackingStartsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <ZonedTimePreview value={field.value} timezone={timezone} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hackingEndsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("hackingEndsLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <ZonedTimePreview value={field.value} timezone={timezone} />
                <FormDescription>{t("mustBeAfterStartTime")}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="showStartCountdown"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel className="font-normal">{t("countdownToStartLabel")}</FormLabel>
                    <FormDescription>{t("countdownDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <CountdownPreview
            values={values}
            judgingStartsAt={config.judgingStartsAt}
            judgingEndsAt={config.judgingEndsAt}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
