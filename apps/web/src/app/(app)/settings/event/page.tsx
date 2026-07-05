"use client";

// Event-wide config (H45/H47). Admins set the name/tagline/timezone and the
// public "hacking window" that drives the countdown shown on the website and TV
// panels. Backed by GET/PUT /api/event (capability SCHEDULE_MANAGE).

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { ApiError, api } from "@/lib/api";
import type { EventConfig } from "@/lib/types";

const schema = z.object({
  name: z.string().max(200),
  tagline: z.string().max(500),
  timezone: z.string().min(1, "Required").max(100),
  // Held as datetime-local strings ("YYYY-MM-DDTHH:mm"); empty means "unset".
  hackingStartsAt: z.string(),
  hackingEndsAt: z.string(),
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
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      tagline: "",
      timezone: "Europe/Madrid",
      hackingStartsAt: "",
      hackingEndsAt: "",
    },
  });
  const { reset } = form;

  // Prefill from the current config on mount.
  useEffect(() => {
    api
      .get<EventConfig>("/api/event")
      .then((cfg) =>
        reset({
          name: cfg.name ?? "",
          tagline: cfg.tagline ?? "",
          timezone: cfg.timezone || "Europe/Madrid",
          hackingStartsAt: toLocalInputValue(cfg.hackingStartsAt),
          hackingEndsAt: toLocalInputValue(cfg.hackingEndsAt),
        }),
      )
      .catch((err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not load event settings."),
      );
  }, [reset]);

  async function onSubmit(values: Values) {
    try {
      // Empty strings become null so the API clears the field (name/tagline are nullable).
      const next = await api.put<EventConfig>("/api/event", {
        name: values.name.trim() || null,
        tagline: values.tagline.trim() || null,
        timezone: values.timezone.trim(),
        hackingStartsAt: fromLocalInputValue(values.hackingStartsAt),
        hackingEndsAt: fromLocalInputValue(values.hackingEndsAt),
      });
      reset({
        name: next.name ?? "",
        tagline: next.tagline ?? "",
        timezone: next.timezone || "Europe/Madrid",
        hackingStartsAt: toLocalInputValue(next.hackingStartsAt),
        hackingEndsAt: toLocalInputValue(next.hackingEndsAt),
      });
      toast.success("Event settings saved.");
    } catch (err) {
      // Surfaces API business errors verbatim (e.g. "hackingEndsAt must be after hackingStartsAt").
      toast.error(err instanceof ApiError ? err.message : "Could not save event settings.");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <SectionCard
          icon={CalendarClockIcon}
          title="Event"
          description="Identity and the public hacking window. Start/end times drive the countdown on the website and TV panels."
          footer={<SubmitButton pending={form.formState.isSubmitting}>Save changes</SubmitButton>}
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. HackUDC 2026" {...field} />
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
                <FormLabel>Tagline</FormLabel>
                <FormControl>
                  <Input placeholder="A short line shown alongside the name" {...field} />
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
                <FormLabel>Timezone</FormLabel>
                <FormControl>
                  <Input placeholder="Europe/Madrid" {...field} />
                </FormControl>
                <FormDescription>
                  IANA timezone name (e.g. Europe/Madrid). Set the hacking times from a machine in
                  this zone — the fields below use your browser&apos;s local time.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="hackingStartsAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hacking starts</FormLabel>
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
                <FormLabel>Hacking ends</FormLabel>
                <FormControl>
                  <DateTimeInput value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormDescription>Must be after the start time.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
