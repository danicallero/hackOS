"use client";

// Event category: identity (name, tagline, timezone) and whether participants
// may self-create projects (H19). Owns its own PUT /api/event save scope.

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { TimezonePicker } from "@/components/common/timezone-picker";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";

const schema = z.object({
  name: z.string().max(200),
  tagline: z.string().max(500),
  timezone: z.string().min(1, "Required").max(100),
  participantsCanCreateProjects: z.boolean(),
});

type Values = z.infer<typeof schema>;

function fromConfig(cfg: EventConfig): Values {
  return {
    name: cfg.name ?? "",
    tagline: cfg.tagline ?? "",
    timezone: cfg.timezone || "Europe/Madrid",
    participantsCanCreateProjects: cfg.participantsCanCreateProjects,
  };
}

export function IdentityTab({
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
      name: "",
      tagline: "",
      timezone: "Europe/Madrid",
      participantsCanCreateProjects: false,
    },
  });
  const { reset, formState } = form;
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, onDirtyChange);

  useEffect(() => {
    if (config) reset(fromConfig(config));
  }, [config, reset]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        name: values.name.trim() || null,
        tagline: values.tagline.trim() || null,
        timezone: values.timezone.trim(),
        participantsCanCreateProjects: values.participantsCanCreateProjects,
      });
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status === "loading" || !config) return null;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={icon}
          title={t("eventTitle")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
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
                  <TimezonePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="participantsCanCreateProjects"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
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
        </SectionCard>
      </form>
    </Form>
  );
}
