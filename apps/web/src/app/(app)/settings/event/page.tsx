"use client";

// Event-wide config (H45/H47). Admins set the name/tagline/timezone and the
// public "hacking window" that drives the countdown shown on the website and TV
// panels. Backed by GET/PUT /api/event (capability SCHEDULE_MANAGE).

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon, GavelIcon, MapPinIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { getQueueSettings, updateQueueSettings } from "@/lib/queue";
import type { EventConfig, PassBackField } from "@/lib/types";

/** Empty rows are dropped and label/value are trimmed before saving. */
function normalizeBackFields(fields: PassBackField[]): PassBackField[] {
  return fields
    .map((field) => ({ label: field.label.trim(), value: field.value.trim() }))
    .filter((field) => field.label.length > 0 && field.value.length > 0);
}

function BackFieldBuilder({
  value,
  onChange,
}: {
  value: PassBackField[];
  onChange: (value: PassBackField[]) => void;
}) {
  const { t } = useLocale();
  const add = () => onChange([...value, { label: "", value: "" }]);
  const update = (index: number, patch: Partial<PassBackField>) =>
    onChange(value.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      {value.map((field, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; a stable id would remount inputs and drop focus.
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          <Input
            value={field.label}
            placeholder={t("backFieldLabelPlaceholder")}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <Input
            value={field.value}
            placeholder={t("backFieldValuePlaceholder")}
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("removeBackFieldAria", { index: index + 1 })}
            onClick={() => remove(index)}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        {t("addBackField")}
      </Button>
    </div>
  );
}

const schema = z.object({
  name: z.string().max(200),
  tagline: z.string().max(500),
  timezone: z.string().min(1, "Required").max(100),
  // Held as datetime-local strings ("YYYY-MM-DDTHH:mm"); empty means "unset".
  hackingStartsAt: z.string(),
  hackingEndsAt: z.string(),
  showStartCountdown: z.boolean(),
  venueName: z.string().max(200),
  // Held as strings so an empty input is representable; parsed to number | null on submit.
  venueLatitude: z.string(),
  venueLongitude: z.string(),
});

type Values = z.infer<typeof schema>;

/**
 * `<input type="datetime-local">` carries NO timezone: its value is a bare
 * wall-clock string. We do a straightforward conversion between that and the
 * API's ISO instant using the *browser's* local zone. Caveat: if the operator's
 * machine is not on the event's timezone (the field below), the displayed
 * wall-clock will not match the event zone — organisers should edit these from a
 * machine in the event's zone (noted on the form).
 */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Shift by the local offset so toISOString() prints local wall-clock, then trim to minutes.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  // `value` is parsed as browser-local wall-clock, yielding the intended instant.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function EventSettingsPage() {
  return (
    <div className="space-y-6">
      <HackingWindowSection />
      <JudgingWindowSection />
    </div>
  );
}

function HackingWindowSection() {
  const { t } = useLocale();
  const [passBackFields, setPassBackFields] = useState<PassBackField[]>([]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      tagline: "",
      timezone: "Europe/Madrid",
      hackingStartsAt: "",
      hackingEndsAt: "",
      showStartCountdown: false,
      venueName: "",
      venueLatitude: "",
      venueLongitude: "",
    },
  });
  const { reset } = form;

  // Prefill from the current config on mount.
  useEffect(() => {
    api
      .get<EventConfig>("/api/event")
      .then((cfg) => {
        reset({
          name: cfg.name ?? "",
          tagline: cfg.tagline ?? "",
          timezone: cfg.timezone || "Europe/Madrid",
          hackingStartsAt: toLocalInputValue(cfg.hackingStartsAt),
          hackingEndsAt: toLocalInputValue(cfg.hackingEndsAt),
          showStartCountdown: cfg.showStartCountdown,
          venueName: cfg.venueName ?? "",
          venueLatitude: cfg.venueLatitude === null ? "" : String(cfg.venueLatitude),
          venueLongitude: cfg.venueLongitude === null ? "" : String(cfg.venueLongitude),
        });
        setPassBackFields(cfg.passBackFields);
      })
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadEventSettings")),
      );
  }, [reset, t]);

  async function onSubmit(values: Values) {
    try {
      // Empty strings become null so the API clears the field (name/tagline are nullable).
      const next = await api.put<EventConfig>("/api/event", {
        name: values.name.trim() || null,
        tagline: values.tagline.trim() || null,
        timezone: values.timezone.trim(),
        hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
        hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
        showStartCountdown: values.showStartCountdown,
        venueName: values.venueName.trim() || null,
        venueLatitude: values.venueLatitude.trim() === "" ? null : Number(values.venueLatitude),
        venueLongitude: values.venueLongitude.trim() === "" ? null : Number(values.venueLongitude),
        passBackFields: normalizeBackFields(passBackFields),
      });
      reset({
        name: next.name ?? "",
        tagline: next.tagline ?? "",
        timezone: next.timezone || "Europe/Madrid",
        hackingStartsAt: toLocalInputValue(next.hackingStartsAt),
        hackingEndsAt: toLocalInputValue(next.hackingEndsAt),
        showStartCountdown: next.showStartCountdown,
        venueName: next.venueName ?? "",
        venueLatitude: next.venueLatitude === null ? "" : String(next.venueLatitude),
        venueLongitude: next.venueLongitude === null ? "" : String(next.venueLongitude),
      });
      setPassBackFields(next.passBackFields);
      toast.success(t("eventSettingsSaved"));
    } catch (err) {
      // Surfaces API business errors verbatim (e.g. "hackingEndsAt must be after hackingStartsAt").
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard icon={CalendarClockIcon} title={t("eventTitle")} description={t("eventDesc")}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={`${t("egPrefix")} HackUDC 2026`} {...field} />
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
                  <Input placeholder={t("taglineShortLinePlaceholder")} {...field} />
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
                  <Input placeholder="Europe/Madrid" {...field} />
                </FormControl>
                <FormDescription>{t("timezoneHintDesc")}</FormDescription>
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
                    <FormLabel>{t("countdownToStartLabel")}</FormLabel>
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
        </SectionCard>
        <SectionCard
          icon={MapPinIcon}
          title={t("venueSectionTitle")}
          description={t("venueSectionDesc")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
          }
        >
          <FormField
            control={form.control}
            name="venueName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("venueNameLabel")}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="venueLatitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("venueLatitudeLabel")}</FormLabel>
                  <FormControl>
                    <Input type="number" step="any" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="venueLongitude"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("venueLongitudeLabel")}</FormLabel>
                  <FormControl>
                    <Input type="number" step="any" {...field} />
                  </FormControl>
                  <FormDescription>{t("venueCoordsBothOrNeither")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="space-y-2">
            <div>
              <Label>{t("passBackFieldsLabel")}</Label>
              <p className="text-muted-foreground text-sm">{t("passBackFieldsDesc")}</p>
            </div>
            <BackFieldBuilder value={passBackFields} onChange={setPassBackFields} />
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}

const judgingSchema = z.object({
  // Held as datetime-local strings ("YYYY-MM-DDTHH:mm"); empty means "unset".
  judgingStartsAt: z.string(),
  judgingEndsAt: z.string(),
});

type JudgingValues = z.infer<typeof judgingSchema>;

/**
 * The judging window (queue_settings.schedule_start_at/schedule_end_at) sizes
 * how much time judging rooms have per project: roomPace() (H39) tightens the
 * per-team budget automatically as this window's end approaches, based on how
 * many projects are still pending. Edited here via a separate resource
 * (/api/queue/settings, capability QUEUE_ADMIN) from the hacking window above.
 */
function JudgingWindowSection() {
  const { t } = useLocale();
  const form = useForm<JudgingValues>({
    resolver: zodResolver(judgingSchema),
    defaultValues: { judgingStartsAt: "", judgingEndsAt: "" },
  });
  const { reset } = form;

  useEffect(() => {
    getQueueSettings()
      .then((settings) =>
        reset({
          judgingStartsAt: toDatetimeLocal(settings.schedule_start_at),
          judgingEndsAt: toDatetimeLocal(settings.schedule_end_at),
        }),
      )
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : t("couldNotLoadJudgingWindow")),
      );
  }, [reset, t]);

  async function onSubmit(values: JudgingValues) {
    try {
      const next = await updateQueueSettings({
        scheduleStartAt: fromDatetimeLocal(values.judgingStartsAt),
        scheduleEndAt: fromDatetimeLocal(values.judgingEndsAt),
      });
      reset({
        judgingStartsAt: toDatetimeLocal(next.schedule_start_at),
        judgingEndsAt: toDatetimeLocal(next.schedule_end_at),
      });
      toast.success(t("judgingWindowSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveJudgingWindow"));
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard
          icon={GavelIcon}
          title={t("judgingWindowTitle")}
          description={t("judgingWindowDesc")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
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
        </SectionCard>
      </form>
    </Form>
  );
}
