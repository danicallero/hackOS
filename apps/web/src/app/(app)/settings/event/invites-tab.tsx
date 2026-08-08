"use client";

// Invited-account logistics category (H10): whether an invited sponsor/staff
// account must supply a shirt size, and whether their claim form shows
// dietary-restriction fields at all. Off by default — not every event caters
// on-site sponsors/staff.

import { zodResolver } from "@hookform/resolvers/zod";
import type { LucideIcon } from "lucide-react";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SaveStatus } from "@/components/common/save-status";
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
  shirtSizes: z
    .array(z.object({ value: z.string().trim().min(1).max(10) }))
    .min(1)
    .refine(
      (sizes) => new Set(sizes.map((s) => s.value.toLowerCase())).size === sizes.length,
      "duplicate",
    ),
});

type Values = z.infer<typeof schema>;

function fromConfig(cfg: EventConfig): Values {
  return {
    requireSponsorShirtSize: cfg.requireSponsorShirtSize,
    requireSponsorDietary: cfg.requireSponsorDietary,
    requireStaffShirtSize: cfg.requireStaffShirtSize,
    requireStaffDietary: cfg.requireStaffDietary,
    shirtSizes: cfg.shirtSizes.map((value) => ({ value })),
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
      shirtSizes: [
        { value: "XS" },
        { value: "S" },
        { value: "M" },
        { value: "L" },
        { value: "XL" },
      ],
    },
  });
  const { reset, formState, control } = form;
  const shirtSizeFields = useFieldArray({ control, name: "shirtSizes" });
  const [saveState, setSaveState] = useCategorySaveState(formState.isDirty, onDirtyChange);

  useEffect(() => {
    if (config) reset(fromConfig(config));
  }, [config, reset]);

  async function onSubmit(values: Values) {
    setSaveState("saving");
    try {
      const next = await api.put<EventConfig>("/api/event", {
        ...values,
        shirtSizes: values.shirtSizes.map((s) => s.value.trim()),
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
    return <EventConfigLoadState icon={icon} title={t("invitesSectionTitle")} />;
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={icon}
          title={t("invitesSectionTitle")}
          description={t("invitesSectionDesc")}
          state={<SaveStatus state={saveState} />}
          footer={<SubmitButton pending={formState.isSubmitting}>{t("saveChanges")}</SubmitButton>}
        >
          <h3 className="text-balance text-sm font-semibold">{t("shirtSizesGroup")}</h3>
          <FormDescription>{t("shirtSizesGroupDesc")}</FormDescription>
          <div className="flex flex-wrap gap-2">
            {shirtSizeFields.fields.map((item, index) => (
              <FormField
                key={item.id}
                control={form.control}
                name={`shirtSizes.${index}.value`}
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-1">
                      <FormControl>
                        <Input {...field} className="w-20" maxLength={10} />
                      </FormControl>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive size-8 shrink-0"
                        disabled={shirtSizeFields.fields.length <= 1}
                        onClick={() => shirtSizeFields.remove(index)}
                      >
                        <XIcon className="size-4" />
                        <span className="sr-only">{t("remove")}</span>
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => shirtSizeFields.append({ value: "" })}
            >
              <PlusIcon />
              {t("addSize")}
            </Button>
          </div>
          {form.formState.errors.shirtSizes?.root?.message && (
            <p className="text-destructive text-sm">{t("shirtSizesDuplicateError")}</p>
          )}
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">
            {t("invitesSponsorsGroup")}
          </h3>
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
