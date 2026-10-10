"use client";

// Event category (EVENT_MANAGE): identity (name, tagline, timezone),
// whether participants may self-create projects (H19), the doors-open/event
// window, and the hacking window that drives the public countdown (H47,
// H49) and TV panels (H42). Merged from the former separate Event/Schedule
// tabs — both are edited by the same "event lead" persona and now share one
// capability and one save scope. Each date/time field shows both the
// browser-local instant being edited and its event-timezone reading, and the
// section previews exactly what the public countdown will show once saved
// (H45's "reveal, no manual toggling" idea applied to the countdown handoff)
// by reusing the same phase logic the public site and TV run.

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { TabBar } from "@/components/common/tab-bar";
import { TimezonePicker } from "@/components/common/timezone-picker";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/event-datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";
import { ZonedTimePreview } from "./zoned-time-preview";

const createSchema = (t: Translate) =>
  z
    .object({
      eventReminderScheduledAt: z.string(),
      name: z.string().max(200, t("tooLong")),
      tagline: z.string().max(500, t("tooLong")),
      timezone: z.string().min(1, t("required")).max(100, t("tooLong")),
      participantsCanCreateProjects: z.boolean(),
      participantSelfServiceStartsAt: z.string(),
      participantSelfServiceEndsAt: z.string(),
      eventStartsAt: z.string(),
      eventEndsAt: z.string(),
      hackingStartsAt: z.string(),
      hackingEndsAt: z.string(),
      showStartCountdown: z.boolean(),
    })
    .superRefine((values, ctx) => {
      if (!values.eventReminderScheduledAt) return;
      if (!values.name.trim() || !values.eventStartsAt) {
        ctx.addIssue({
          code: "custom",
          path: ["eventReminderScheduledAt"],
          message: t("eventReminderNeedsDetails"),
        });
        return;
      }
      const sendAt = new Date(values.eventReminderScheduledAt).getTime();
      if (
        !Number.isFinite(sendAt) ||
        sendAt <= Date.now() ||
        sendAt >= new Date(values.eventStartsAt).getTime()
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["eventReminderScheduledAt"],
          message: t("eventReminderInvalidDate"),
        });
      }
    });

// Once a value is set the time input gains right padding for the clear button,
// skewing the date/time split against empty rows (R010); reserving it on both
// inputs keeps every row identical.
const EQUAL_SPLIT = "pr-9";

type Values = z.infer<ReturnType<typeof createSchema>>;

function fromConfig(cfg: EventConfig): Values {
  return {
    eventReminderScheduledAt:
      cfg.eventReminder?.status === "scheduled"
        ? toLocalInputValue(cfg.eventReminder.scheduled_at)
        : "",
    name: cfg.name ?? "",
    tagline: cfg.tagline ?? "",
    timezone: cfg.timezone || "Europe/Madrid",
    participantsCanCreateProjects: cfg.participantsCanCreateProjects,
    participantSelfServiceStartsAt: toLocalInputValue(cfg.participantSelfServiceStartsAt),
    participantSelfServiceEndsAt: toLocalInputValue(cfg.participantSelfServiceEndsAt),
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
  values: Pick<Values, "hackingStartsAt" | "hackingEndsAt" | "showStartCountdown">;
  judgingStartsAt: string | null;
  judgingEndsAt: string | null;
}) {
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

  // No hacking window yet: nothing to preview, so no empty box.
  if (phase.kind === "none") return null;

  return (
    <div className="rounded-lg border p-4">
      <EventPhaseDisplay phase={phase} className="type-page-title tabular-nums" />
    </div>
  );
}

export function EventTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const reminderLabelId = useId();
  const [view, setView] = useState("general");
  const { config, status, applyConfig } = useEventConfig();
  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: {
      eventReminderScheduledAt: "",
      name: "",
      tagline: "",
      timezone: "Europe/Madrid",
      participantsCanCreateProjects: false,
      participantSelfServiceStartsAt: "",
      participantSelfServiceEndsAt: "",
      eventStartsAt: "",
      eventEndsAt: "",
      hackingStartsAt: "",
      hackingEndsAt: "",
      showStartCountdown: false,
    },
  });
  const { reset, formState, control } = form;
  const values = useWatch({ control });
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, onDirtyChange);

  useEffect(() => {
    if (config) reset(fromConfig(config));
  }, [config, reset]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        ...(form.formState.dirtyFields.eventReminderScheduledAt
          ? { eventReminderScheduledAt: fromLocalInputValue(values.eventReminderScheduledAt) }
          : {}),
        name: values.name.trim() || null,
        tagline: values.tagline.trim() || null,
        timezone: values.timezone.trim(),
        participantsCanCreateProjects: values.participantsCanCreateProjects,
        participantSelfServiceStartsAt: fromLocalInputValue(values.participantSelfServiceStartsAt),
        participantSelfServiceEndsAt: fromLocalInputValue(values.participantSelfServiceEndsAt),
        eventStartsAt: fromLocalInputValue(values.eventStartsAt),
        eventEndsAt: fromLocalInputValue(values.eventEndsAt),
        hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
        hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
        showStartCountdown: values.showStartCountdown,
      });
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("toastEventSettings") });
    } catch (err) {
      setSaveState("error");
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"),
        t("toastEventSettings"),
      );
    }
  }

  // A validation error on a hidden tab would otherwise block Save silently.
  function revealInvalidTab(errors: Record<string, unknown>) {
    const names = Object.keys(errors);
    if (names.some((n) => ["name", "tagline", "timezone"].includes(n))) setView("general");
    else if (names.some((n) => n.startsWith("participantSelfService"))) setView("participants");
    else if (names.length > 0) setView("schedule");
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState />;
  }
  const timezone = values.timezone ?? config.timezone;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, revealInvalidTab)}>
        <Tabs value={view} onValueChange={setView}>
          <TabBar className="[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] sm:[mask-image:none] flex-row! h-(--control-height-default)! [&_[data-slot=tabs-trigger]]:w-auto! [&_[data-slot=tabs-trigger]]:justify-center!">
            <TabsTrigger value="general">{t("eventGeneralTab")}</TabsTrigger>
            <TabsTrigger value="schedule">{t("scheduleSectionTitle")}</TabsTrigger>
            <TabsTrigger value="participants">{t("eventParticipantsTab")}</TabsTrigger>
          </TabBar>
          <SectionCard
            variant="plain"
            footerClassName="justify-start"
            stickyFooter
            footer={<FormActions pending={formState.isSubmitting} state={saveState} />}
          >
            <TabsContent
              value="general"
              forceMount
              hidden={view !== "general"}
              className="space-y-(--space-within-section)"
            >
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="tagline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("taglineLabel")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("timezoneLabel")}</FormLabel>
                      <FormControl>
                        <TimezonePicker value={field.value} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>
            <TabsContent
              value="schedule"
              forceMount
              hidden={view !== "schedule"}
              className="space-y-(--space-within-section)"
            >
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {(
                  [
                    {
                      name: "eventStartsAt",
                      label: "eventStartsLabel",
                      description: "eventStartsDesc",
                    },
                    { name: "eventEndsAt", label: "eventEndsLabel", description: "eventEndsDesc" },
                    { name: "hackingStartsAt", label: "hackingStartsLabel" },
                    { name: "hackingEndsAt", label: "hackingEndsLabel" },
                  ] as const
                ).map((date) => (
                  <FormField
                    key={date.name}
                    control={form.control}
                    name={date.name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t(date.label)}</FormLabel>
                        <FormControl>
                          <DateTimeInput
                            value={field.value}
                            onChange={field.onChange}
                            className={EQUAL_SPLIT}
                          />
                        </FormControl>
                        <ZonedTimePreview value={field.value} timezone={timezone} />
                        {"description" in date && (
                          <FormDescription>{t(date.description)}</FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
              <FormField
                control={form.control}
                name="showStartCountdown"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-4 py-3">
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
                values={{
                  hackingStartsAt: values.hackingStartsAt ?? "",
                  hackingEndsAt: values.hackingEndsAt ?? "",
                  showStartCountdown: values.showStartCountdown ?? false,
                }}
                judgingStartsAt={config.judgingStartsAt}
                judgingEndsAt={config.judgingEndsAt}
              />
              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <h3 id={reminderLabelId} className="text-balance text-sm font-semibold">
                    {t("eventReminderTitle")}
                  </h3>
                  <Switch
                    aria-labelledby={reminderLabelId}
                    checked={!!values.eventReminderScheduledAt}
                    onCheckedChange={(checked) =>
                      form.setValue(
                        "eventReminderScheduledAt",
                        checked
                          ? toLocalInputValue(
                              new Date(
                                Math.max(
                                  Date.now() + 3600000,
                                  new Date(
                                    fromLocalInputValue(values.eventStartsAt ?? "") ?? Date.now(),
                                  ).getTime() - 86400000,
                                ),
                              ).toISOString(),
                            )
                          : "",
                        { shouldDirty: true, shouldValidate: true },
                      )
                    }
                  />
                </div>
                {values.eventReminderScheduledAt && (
                  <>
                    <p className="text-muted-foreground text-sm">{t("eventReminderAudience")}</p>
                    <FormField
                      control={form.control}
                      name="eventReminderScheduledAt"
                      render={({ field }) => (
                        <FormItem className="max-w-md">
                          <FormLabel>{t("eventReminderSendAt")}</FormLabel>
                          <FormControl>
                            <DateTimeInput
                              value={field.value}
                              onChange={field.onChange}
                              max={values.eventStartsAt}
                              className={EQUAL_SPLIT}
                            />
                          </FormControl>
                          <ZonedTimePreview value={field.value} timezone={timezone} />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                {config.eventReminder?.status === "queued" && (
                  <p className="text-sm">
                    {t("eventReminderQueued", { count: config.eventReminder.recipient_count })}
                  </p>
                )}
                {config.eventReminder?.status === "expired" && (
                  <p className="text-sm">{t("eventReminderExpired")}</p>
                )}
              </div>
            </TabsContent>
            <TabsContent
              value="participants"
              forceMount
              hidden={view !== "participants"}
              className="space-y-(--space-within-section)"
            >
              <FormField
                control={form.control}
                name="participantsCanCreateProjects"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-4 py-3">
                      <FormLabel className="font-normal">
                        {t("participantsCanCreateProjectsLabel")}
                      </FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div>
                <h3 className="text-balance text-sm font-semibold">
                  {t("participantSelfServiceTitle")}
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t("participantSelfServiceDesc")}
                </p>
              </div>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="participantSelfServiceStartsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("participantSelfServiceStartsLabel")}</FormLabel>
                      <FormControl>
                        <DateTimeInput
                          value={field.value}
                          onChange={field.onChange}
                          className={EQUAL_SPLIT}
                        />
                      </FormControl>
                      <ZonedTimePreview value={field.value} timezone={timezone} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="participantSelfServiceEndsAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("participantSelfServiceEndsLabel")}</FormLabel>
                      <FormControl>
                        <DateTimeInput
                          value={field.value}
                          onChange={field.onChange}
                          className={EQUAL_SPLIT}
                        />
                      </FormControl>
                      <ZonedTimePreview value={field.value} timezone={timezone} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </TabsContent>
          </SectionCard>
        </Tabs>
      </form>
    </Form>
  );
}
