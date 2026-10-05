"use client";

// Presence policy category (H24): the two knobs behind automatic presence
// estimation. Keep each policy's consequence beside its control (H24).

import { zodResolver } from "@hookform/resolvers/zod";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
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
import { fromLocalInputValue, toLocalInputValue } from "@/lib/event-datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";
import { ZonedTimePreview } from "./zoned-time-preview";

const createSchema = (t: Translate) =>
  z.object({
    presenceAutoEntryAt: z.string(),
    presenceCertaintyWindowMinutes: z
      .number({ error: t("fieldMustBeNumber") })
      .int(t("fieldMustBeNumber"))
      .min(15, t("tooSmall"))
      .max(10080, t("tooLarge")),
  });

type Values = z.infer<ReturnType<typeof createSchema>>;

function fromConfig(cfg: EventConfig): Values {
  return {
    presenceAutoEntryAt: toLocalInputValue(cfg.presenceAutoEntryAt),
    presenceCertaintyWindowMinutes: cfg.presenceCertaintyWindowMinutes,
  };
}

export function PresenceTab({
  icon,
  onDirtyChange,
}: {
  icon: PhosphorIcon;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { config, status, applyConfig } = useEventConfig();
  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)),
    defaultValues: { presenceAutoEntryAt: "", presenceCertaintyWindowMinutes: 720 },
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
        presenceAutoEntryAt: fromLocalInputValue(values.presenceAutoEntryAt),
        presenceCertaintyWindowMinutes: values.presenceCertaintyWindowMinutes,
      });
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("attendanceTab") });
    } catch (err) {
      setSaveState("error");
      toast.error(
        err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"),
        t("attendanceTab"),
      );
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("presencePolicyTitle")} />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          variant="plain"
          footerClassName="justify-start"
          stickyFooter
          footer={<FormActions pending={formState.isSubmitting} state={saveState} />}
        >
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="presenceAutoEntryAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("automaticEntryTime")}</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
                  <ZonedTimePreview value={field.value} timezone={config.timezone} />
                  <FormDescription>{t("automaticEntryTimeDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="presenceCertaintyWindowMinutes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("certaintyWindow")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={15}
                      max={10080}
                      step={15}
                      value={field.value}
                      onChange={(event) => field.onChange(event.target.valueAsNumber)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>{t("certaintyWindowDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}
