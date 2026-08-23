"use client";

// Form metadata editor (H11): trilingual name/description, window, limits.

import { zodResolver } from "@hookform/resolvers/zod";
import { SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { APPLICATION_TYPES, type ApplicationForm, fromLocalInput, toLocalInput } from "../lib";

const metaSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  type: z.enum(APPLICATION_TYPES),
  description: z.string(),
  active: z.boolean(),
  open_at: z.string(),
  close_at: z.string(),
  capacity: z.string(),
  confirmation_window_hours: z.string(),
  ask_shirt_size: z.boolean(),
  ask_food_intolerances: z.boolean(),
});
type MetaValues = z.infer<typeof metaSchema>;

export function MetadataCard({
  form,
  onSaved,
  onDirtyChange,
}: {
  form: ApplicationForm;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const localizedMetaSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        type: z.enum(APPLICATION_TYPES),
        description: z.string(),
        active: z.boolean(),
        open_at: z.string(),
        close_at: z.string(),
        capacity: z.string(),
        confirmation_window_hours: z.string(),
        ask_shirt_size: z.boolean(),
        ask_food_intolerances: z.boolean(),
      }),
    [t],
  );
  const rhf = useForm<MetaValues>({
    resolver: zodResolver(localizedMetaSchema),
    defaultValues: {
      name: form.name,
      type: form.type,
      description: form.description ?? "",
      active: form.active,
      open_at: toLocalInput(form.open_at),
      close_at: toLocalInput(form.close_at),
      capacity: form.capacity != null ? String(form.capacity) : "",
      confirmation_window_hours: String(form.confirmation_window_hours),
      ask_shirt_size: form.ask_shirt_size,
      ask_food_intolerances: form.ask_food_intolerances,
    },
  });

  useEffect(() => {
    onDirtyChange?.(rhf.formState.isDirty);
  }, [rhf.formState.isDirty, onDirtyChange]);

  async function onSubmit(values: MetaValues) {
    const capacityNum = values.capacity.trim() ? Number(values.capacity) : null;
    if (capacityNum !== null && (!Number.isInteger(capacityNum) || capacityNum < 1)) {
      rhf.setError("capacity", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    const windowHours = Number(values.confirmation_window_hours);
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      rhf.setError("confirmation_window_hours", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    try {
      setSaveState("saving");
      // PATCH /api/applications/:id (APPLICATIONS_MANAGE) — audited server-side (H11/H53).
      await api.patch<ApplicationForm>(`/api/applications/${form.id}`, {
        name: values.name.trim(),
        type: values.type,
        description: values.description.trim() || null,
        active: values.active,
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
        capacity: capacityNum,
        confirmation_window_hours: windowHours,
        ask_shirt_size: values.ask_shirt_size,
        ask_food_intolerances: values.ask_food_intolerances,
      });
      await onSaved();
      rhf.reset(values);
      setSaveState("saved");
      toast.success(t("formUpdated"));
    } catch (err) {
      setSaveState("error");
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveForm"));
    }
  }

  return (
    <Form {...rhf}>
      <form onSubmit={rhf.handleSubmit(onSubmit)}>
        <SectionCard
          icon={SettingsIcon}
          title={t("formSettings")}
          footer={
            <>
              <SaveStatus
                state={
                  rhf.formState.isSubmitting
                    ? "saving"
                    : saveState === "error"
                      ? "error"
                      : rhf.formState.isDirty
                        ? "unsaved"
                        : "saved"
                }
                className="mr-auto"
              />
              <SubmitButton pending={rhf.formState.isSubmitting}>{t("saveSettings")}</SubmitButton>
            </>
          }
        >
          <h3 className="text-balance text-sm font-semibold">{t("builderBasics")}</h3>
          <FormField
            control={rhf.control}
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
            control={rhf.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("personTypeLabel")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {APPLICATION_TYPES.map((type) => (
                      <SelectItem key={type} value={type} className="capitalize">
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={rhf.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("descriptionLabel")}</FormLabel>
                <FormControl>
                  <Textarea rows={2} placeholder={t("shownToApplicantsPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">
            {t("builderLogistics")}
          </h3>
          <FormField
            control={rhf.control}
            name="ask_shirt_size"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <FormLabel className="font-normal">{t("askShirtSizeLabel")}</FormLabel>
                    {field.value && (
                      <StatusBadge tone="neutral" dot={false}>
                        {t("requiredAtSubmitBadge")}
                      </StatusBadge>
                    )}
                  </div>
                  <FormDescription>{t("askShirtSizeDesc")}</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={rhf.control}
            name="ask_food_intolerances"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
                <div className="space-y-0.5">
                  <FormLabel className="font-normal">{t("askFoodIntolerancesLabel")}</FormLabel>
                  <FormDescription>{t("askFoodIntolerancesDesc")}</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">
            {t("builderAvailability")}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={rhf.control}
              name="open_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colOpens")}</FormLabel>
                  <FormControl>
                    <DateTimeInput
                      value={field.value}
                      onChange={field.onChange}
                      nullOption={{ label: t("openImmediately") }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="close_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colCloses")}</FormLabel>
                  <FormControl>
                    <DateTimeInput
                      value={field.value}
                      onChange={field.onChange}
                      nullOption={{ label: t("neverCloses") }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={rhf.control}
              name="capacity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("colQuota")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder={t("unlimitedPlaceholder")}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>{t("optionalCapDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={rhf.control}
              name="confirmation_window_hours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("confirmWindowLabel")}</FormLabel>
                  <FormControl>
                    <Input type="number" min={1} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <h3 className="border-t pt-4 text-balance text-sm font-semibold">{t("builderReview")}</h3>
          <FormField
            control={rhf.control}
            name="active"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <FormLabel>{t("activeLabel")}</FormLabel>
                  <FormDescription>{t("inactiveFormsDesc")}</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );
}
