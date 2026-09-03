"use client";

// Form metadata editor (H11): trilingual name/description, window, limits.

import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon, SettingsIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DateTimeInput } from "@/components/common/datetime-input";
import { MultiSelect } from "@/components/common/multi-select";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import type { RoleSummary } from "@/lib/types";
import { type ApplicationForm, fromLocalInput, toLocalInput } from "../lib";

// Runtime validator is built inside the component with useMemo so its error
// message can be localized via t("required"). Type is defined separately.
type MetaValues = {
  name: string;
  description: string;
  open_at: string;
  close_at: string;
  capacity: string;
  confirmation_window_hours: string;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  grants_role_ids: string[];
};

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
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const localizedMetaSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        description: z.string(),
        open_at: z.string(),
        close_at: z.string(),
        capacity: z.string(),
        confirmation_window_hours: z.string(),
        ask_shirt_size: z.boolean(),
        ask_food_intolerances: z.boolean(),
        grants_role_ids: z.array(z.string()),
      }),
    [t],
  );
  const rhf = useForm<MetaValues>({
    resolver: zodResolver(localizedMetaSchema),
    defaultValues: {
      name: form.name,
      description: form.description ?? "",
      open_at: toLocalInput(form.open_at),
      close_at: toLocalInput(form.close_at),
      capacity: form.capacity != null ? String(form.capacity) : "",
      confirmation_window_hours: String(form.confirmation_window_hours),
      ask_shirt_size: form.ask_shirt_size,
      ask_food_intolerances: form.ask_food_intolerances,
      grants_role_ids: form.grants_role_ids.map(String),
    },
  });

  useEffect(() => {
    // A protected role (system:superadmin today, CLI-only, H8) is never
    // offerable as a grantable role — the assign route would 403 it anyway.
    api
      .get<RoleSummary[]>("/api/roles")
      .then((r) => setRoles(r.filter((role) => !role.isProtected)))
      .catch(() => setRoles([]));
  }, []);

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
        description: values.description.trim() || null,
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
        capacity: capacityNum,
        confirmation_window_hours: windowHours,
        ask_shirt_size: values.ask_shirt_size,
        ask_food_intolerances: values.ask_food_intolerances,
        grants_role_ids: values.grants_role_ids.map(Number),
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
          <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
            <div className="space-y-4">
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("descriptionLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        placeholder={t("shownToApplicantsPlaceholder")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-4">
              <h3 className="border-t pt-4 text-balance text-sm font-semibold lg:border-t-0 lg:pt-0">
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
            </div>
            <div className="space-y-4 lg:col-span-2">
              <h3 className="border-t pt-4 text-balance text-sm font-semibold">
                {t("builderAvailability")}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField
                  control={rhf.control}
                  name="open_at"
                  render={({ field }) => (
                    <FormItem className="lg:col-span-2">
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
                    <FormItem className="lg:col-span-2">
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
                <FormField
                  control={rhf.control}
                  name="capacity"
                  render={({ field }) => (
                    <FormItem className="lg:col-span-2">
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
                    <FormItem className="lg:col-span-2">
                      <FormLabel>{t("confirmWindowLabel")}</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <div className="space-y-4 lg:col-span-2">
              <h3 className="border-t pt-4 text-balance text-sm font-semibold">
                {t("builderReview")}
              </h3>
              <FormField
                control={rhf.control}
                name="grants_role_ids"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("grantsRolesLabel")}</FormLabel>
                    <FormControl>
                      <MultiSelect
                        options={roles.map((role) => ({
                          value: String(role.id),
                          label: role.name,
                        }))}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder={t("grantsRolesPlaceholder")}
                        searchPlaceholder={t("searchRolesPlaceholder")}
                        emptyText={t("noRolesYet")}
                      />
                    </FormControl>
                    <FormDescription>{t("grantsRolesDesc")}</FormDescription>
                    {form.has_confirmed_responses && (
                      <Alert>
                        <InfoIcon aria-hidden="true" />
                        <AlertDescription>{t("grantsRolesNotRetroactiveNotice")}</AlertDescription>
                      </Alert>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </SectionCard>
      </form>
    </Form>
  );
}
