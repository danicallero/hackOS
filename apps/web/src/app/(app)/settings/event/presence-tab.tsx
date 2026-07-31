"use client";

// Presence policy category (H24): the two knobs behind automatic presence
// estimation. The explanation of how the estimator combines door/meal/
// activity signals is domain-unfamiliar and rarely needed once set, so it
// sits under progressive disclosure instead of dominating the default view.

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/event-datetime";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";

const schema = z.object({
  presenceAutoEntryAt: z.string(),
  presenceCertaintyWindowMinutes: z.number().int().min(15).max(10080),
});

type Values = z.infer<typeof schema>;

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
  icon: LucideIcon;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const { config, status, applyConfig } = useEventConfig();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
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
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("presencePolicyTitle")} />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={icon}
          title={t("presencePolicyTitle")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="presenceAutoEntryAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("automaticEntryTime")}</FormLabel>
                  <FormControl>
                    <DateTimeInput value={field.value} onChange={field.onChange} />
                  </FormControl>
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
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground -ml-2"
              >
                <ChevronDownIcon className="size-4" />
                {t("presencePolicyDetailsToggle")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-muted-foreground space-y-2 pt-2 text-sm text-pretty">
              <p>{t("presencePolicyDesc")}</p>
              <p>{t("automaticEntryTimeDesc")}</p>
              <p>{t("certaintyWindowDesc")}</p>
            </CollapsibleContent>
          </Collapsible>
        </SectionCard>
      </form>
    </Form>
  );
}
