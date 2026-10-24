"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { CertificateTypesManager } from "@/components/certificates/certificate-types-manager";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
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
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { CertificateSettings } from "@/lib/certificates";
import { type Translate, useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { useCategorySaveState } from "./use-category-save-state";

const schema = (t: Translate) =>
  z
    .object({
      automatic: z.boolean(),
      minReviewHours: z
        .string()
        .refine(
          (value) =>
            value.trim() === "" ||
            (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 999),
          t("fieldMustBeNumber"),
        ),
      minHours: z
        .string()
        .refine(
          (value) =>
            value.trim() === "" ||
            (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 999),
          t("fieldMustBeNumber"),
        ),
      awardHours: z
        .string()
        .refine(
          (value) =>
            value.trim() === "" ||
            (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 999),
          t("fieldMustBeNumber"),
        ),
      requiresDemo: z.boolean(),
      issuerName: z.string().trim().min(1, t("required")).max(200, t("tooLong")),
    })
    .superRefine((values, ctx) => {
      if (values.automatic && values.minHours.trim() === "")
        ctx.addIssue({ code: "custom", path: ["minHours"], message: t("required") });
    });
type Values = z.infer<ReturnType<typeof schema>>;
const fromSettings = (settings: CertificateSettings): Values => ({
  automatic: settings.minHours !== null,
  minReviewHours: settings.minReviewHours == null ? "" : String(settings.minReviewHours),
  minHours: settings.minHours == null ? "" : String(settings.minHours),
  awardHours: settings.awardHours == null ? "" : String(settings.awardHours),
  requiresDemo: settings.requiresDemo,
  issuerName: settings.issuerName,
});

/** #1083: the certificate policy has one capability and one category Save. */
export function CertificatesTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const resource = useServerResource(["certificate-settings"], () =>
    api.get<CertificateSettings>("/api/certificates/settings"),
  );
  if (resource.error)
    return (
      <ContextualError
        message={apiErrorText(resource.error, t, t("couldNotLoadCertificates"))}
        onRetry={resource.reload}
      />
    );
  if (!resource.data)
    return (
      <div className="flex justify-center py-10" role="status">
        <Spinner className="size-6" />
      </div>
    );
  return (
    <>
      <CertificatePolicyForm
        settings={resource.data}
        onSaved={resource.mutate}
        onDirtyChange={onDirtyChange}
      />
      <CertificateTypesManager />
    </>
  );
}

function CertificatePolicyForm({
  settings,
  onSaved,
  onDirtyChange,
}: {
  settings: CertificateSettings;
  onSaved: (settings: CertificateSettings) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useLocale();
  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema(t)),
    defaultValues: fromSettings(settings),
  });
  const [saveState, setSaveState] = useCategorySaveState(form.formState.isDirty, onDirtyChange);
  const [error, setError] = useState<string | null>(null);
  const automatic = form.watch("automatic");
  async function save(values: Values) {
    setError(null);
    setSaveState("saving");
    try {
      const dirty = form.formState.dirtyFields;
      const next = await api.put<CertificateSettings>("/api/certificates/settings", {
        ...((dirty.automatic || dirty.minHours) && {
          minHours: values.automatic ? Number(values.minHours) : null,
        }),
        ...(dirty.minReviewHours && {
          minReviewHours:
            values.minReviewHours.trim() === "" ? null : Number(values.minReviewHours),
        }),
        ...(dirty.awardHours && {
          awardHours: values.awardHours.trim() === "" ? null : Number(values.awardHours),
        }),
        ...(dirty.requiresDemo && { requiresDemo: values.requiresDemo }),
        ...(dirty.issuerName && { issuerName: values.issuerName }),
      });
      onSaved(next);
      form.reset(fromSettings(next));
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("certificates") });
    } catch (err) {
      setSaveState("error");
      setError(apiErrorText(err, t, t("couldNotSaveEventSettings")));
    }
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(save)}>
        <SectionCard
          variant="plain"
          stickyFooter
          footer={
            <FormActions
              pending={form.formState.isSubmitting}
              state={saveState}
              disabled={!form.formState.isDirty}
            />
          }
        >
          {error && <ContextualError message={error} />}
          <fieldset disabled={form.formState.isSubmitting} className="space-y-6">
            <FormField
              control={form.control}
              name="automatic"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4">
                  <FormLabel>{t("certificateAutomaticIssue")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            {automatic && (
              <FormField
                control={form.control}
                name="minHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("certificateMinConfirmedHours")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={0}
                        max={999}
                        step={0.01}
                        className="max-w-48 tabular-nums"
                      />
                    </FormControl>
                    <FormDescription>{t("certificateConfirmedHoursHelp")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="minReviewHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("certificateMinReviewHours")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0}
                      max={999}
                      step={0.01}
                      className="max-w-48 tabular-nums"
                    />
                  </FormControl>
                  <FormDescription>{t("certificateReviewThresholdHelp")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="awardHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("certificatePolicyAwardHours")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      min={0.01}
                      max={999}
                      step={0.01}
                      className="max-w-48 tabular-nums"
                    />
                  </FormControl>
                  <FormDescription>{t("certificatePolicyAwardHoursHelp")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="requiresDemo"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between gap-4">
                  <FormLabel>{t("certificateRequiresDemo")}</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="issuerName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("certificateIssuerName")}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </fieldset>
        </SectionCard>
      </form>
    </Form>
  );
}
