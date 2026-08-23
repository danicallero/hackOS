"use client";

// Invited-account requirements category (INVITES_MANAGE, H10): whether an
// invited sponsor/staff account must supply a shirt size, and whether their
// claim form shows dietary-restriction fields at all. Off by default — not
// every event caters on-site sponsors/staff. The shirt-size catalogue itself
// lives in Settings → Libraries, next to the other shared reference lists
// (food intolerances, universities) that feed application forms and
// profiles — this tab only owns the two invite-claim requirement toggles.

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EventConfig } from "@/lib/types";
import { EventConfigLoadState, useEventConfig } from "./event-config-context";
import { useCategorySaveState } from "./use-category-save-state";

const schema = z.object({
  requireSponsorShirtSize: z.boolean(),
  requireSponsorDietary: z.boolean(),
  requireStaffShirtSize: z.boolean(),
  requireStaffDietary: z.boolean(),
});

type Values = z.infer<typeof schema>;

function fromConfig(cfg: EventConfig): Values {
  return {
    requireSponsorShirtSize: cfg.requireSponsorShirtSize,
    requireSponsorDietary: cfg.requireSponsorDietary,
    requireStaffShirtSize: cfg.requireStaffShirtSize,
    requireStaffDietary: cfg.requireStaffDietary,
  };
}

export function InvitesTab({
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
      requireSponsorShirtSize: false,
      requireSponsorDietary: false,
      requireStaffShirtSize: false,
      requireStaffDietary: false,
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
      const next = await api.put<EventConfig>("/api/event", values);
      applyConfig(next);
      reset(fromConfig(next));
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveEventSettings"));
    }
  }

  if (status !== "ready" || !config) {
    return <EventConfigLoadState icon={icon} title={t("invitesSectionTitle")} />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={icon}
          title={t("invitesSectionTitle")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
          <h3 className="text-balance text-sm font-semibold">{t("invitesSponsorsGroup")}</h3>
          <FormField
            control={form.control}
            name="requireSponsorShirtSize"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel className="font-normal">
                      {t("requireSponsorShirtSizeLabel")}
                    </FormLabel>
                    <FormDescription>{t("requireSponsorShirtSizeDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requireSponsorDietary"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel className="font-normal">{t("requireSponsorDietaryLabel")}</FormLabel>
                    <FormDescription>{t("requireSponsorDietaryDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">
            {t("invitesStaffGroup")}
          </h3>
          <FormField
            control={form.control}
            name="requireStaffShirtSize"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel className="font-normal">{t("requireStaffShirtSizeLabel")}</FormLabel>
                    <FormDescription>{t("requireStaffShirtSizeDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requireStaffDietary"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <FormLabel className="font-normal">{t("requireStaffDietaryLabel")}</FormLabel>
                    <FormDescription>{t("requireStaffDietaryDesc")}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
