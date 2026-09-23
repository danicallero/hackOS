"use client";

// Application form creation (H11): a focused full page rather than a modal.
// Authors start with the name and availability window; optional policy lives
// in the application's advanced form settings after creation.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardListIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { DateTimeInput } from "@/components/common/datetime-input";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import { type ApplicationForm, fromLocalInput } from "../lib";

// Runtime validator is built inside the component with useMemo so its error
// message can be localized via t("required"). Type is defined separately.
type CreateValues = {
  name: string;
  open_at: string;
  close_at: string;
};

const EMPTY: CreateValues = {
  name: "",
  open_at: "",
  close_at: "",
};

export default function NewApplicationFormPage() {
  const router = useRouter();
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const localizedCreateSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        open_at: z.string(),
        close_at: z.string(),
      }),
    [t],
  );

  const form = useForm<CreateValues>({
    resolver: zodResolver(localizedCreateSchema),
    defaultValues: EMPTY,
  });

  async function onCreate(values: CreateValues) {
    try {
      // POST /api/applications (APPLICATIONS_MANAGE). The creation step asks
      // only what is needed to begin; optional form policy lives in the
      // builder's advanced form settings (H11).
      const created = await api.post<ApplicationForm>("/api/applications", {
        name: values.name.trim(),
        template: [],
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
      });
      toast.success(t("formCreated"));
      router.push(`/applications/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateForm"));
    }
  }

  if (!canManage) {
    return <AccessDenied ask={t("applicationsAccessDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("newApplicationForm")} />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onCreate)}>
          <SectionCard
            icon={ClipboardListIcon}
            footer={
              <SubmitButton pending={form.formState.isSubmitting}>{t("createForm")}</SubmitButton>
            }
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("exampleFormNamePlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
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
                control={form.control}
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
          </SectionCard>
        </form>
      </Form>
    </div>
  );
}
