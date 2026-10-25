"use client";

// Form sections shared by the create panel and the enterprise detail editor
// (#1135), so both surfaces keep identical fields, validation and wiring.

import type { Dispatch, SetStateAction } from "react";
import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { PublicationControls } from "@/components/common/publication-controls";
import {
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
import { Textarea } from "@/components/ui/textarea";
import { toDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

export const enterpriseFormSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  priority: optionalPositiveInt,
  kind: z.enum(["sponsor", "collaborator"]),
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
export type EnterpriseFormValues = z.infer<typeof enterpriseFormSchema>;

type EnterpriseForm = UseFormReturn<EnterpriseFormValues>;

export function EnterpriseProfileFields({
  form,
  nameDisabled = false,
}: {
  form: EnterpriseForm;
  nameDisabled?: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("name")}</FormLabel>
            <FormControl>
              <Input disabled={nameDisabled} {...field} />
            </FormControl>
            {nameDisabled && <FormDescription>{t("contactStaffToChangeName")}</FormDescription>}
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="website"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("websiteLabel")}</FormLabel>
            <FormControl>
              <Input type="url" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("descriptionLabel")}</FormLabel>
            <FormControl>
              <Textarea rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EnterpriseLogoUrlFields({ form }: { form: EnterpriseForm }) {
  const { t } = useLocale();
  return (
    <>
      <FormField
        control={form.control}
        name="logoUrl"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("logoUrlLabel")}</FormLabel>
            <FormControl>
              <Input type="url" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="logoNegativeUrl"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("darkBackgroundLogoUrlLabel")}</FormLabel>
            <FormControl>
              <Input type="url" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EnterpriseKindPriorityFields({ form }: { form: EnterpriseForm }) {
  const { t } = useLocale();
  return (
    <>
      <FormField
        control={form.control}
        name="kind"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("enterpriseKindLabel")}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="sponsor">{t("enterpriseKindSponsor")}</SelectItem>
                <SelectItem value="collaborator">{t("enterpriseKindCollaborator")}</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="priority"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("priorityLabel")}</FormLabel>
            <FormControl>
              <Input inputMode="numeric" {...field} />
            </FormControl>
            <FormDescription>{t("lowerShowsFirstDesc")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

export function EnterprisePublicationFields({
  form,
  scheduled,
  setScheduled,
}: {
  form: EnterpriseForm;
  scheduled: boolean;
  setScheduled: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useLocale();
  return (
    <PublicationControls
      id="enterprise-publication"
      visibility={form.watch("visibility")}
      hiddenValue="hidden"
      publishedValue="visible"
      hiddenLabel={t("hiddenOption")}
      publishedLabel={t("visibleLabel")}
      visibilityLabel={t("colVisibility")}
      scheduleLabel={t("schedulePublicationLabel")}
      publishAtLabel={t("publishAtLabel")}
      scheduled={scheduled}
      publishAt={form.watch("availableFrom")}
      onVisibilityChange={(next) => {
        form.setValue("visibility", next, { shouldDirty: true });
        if (next === "visible") {
          setScheduled(false);
          form.setValue("availableFrom", "", { shouldDirty: true });
        }
      }}
      onScheduledChange={(next) => {
        setScheduled(next);
        form.setValue("availableFrom", next ? toDatetimeLocal(new Date().toISOString()) : "", {
          shouldDirty: true,
        });
      }}
      onPublishAtChange={(value) => form.setValue("availableFrom", value, { shouldDirty: true })}
    />
  );
}
