"use client";

// Application form creation (H11): a full page rather than a modal — the
// field set (basics, logistics toggles, availability window, granted roles,
// capacity/confirmation window) is genuinely multi-field, matching the
// full-page builder at /applications/[id] rather than a cramped dialog.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardListIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { BackLink } from "@/components/common/back-link";
import { DateTimeInput } from "@/components/common/datetime-input";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
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
import { Switch } from "@/components/ui/switch";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { RoleSummary } from "@/lib/types";
import { type ApplicationForm, fromLocalInput } from "../lib";

// Runtime validator is built inside the component with useMemo so its error
// message can be localized via t("required"). Type is defined separately.
type CreateValues = {
  name: string;
  open_at: string;
  close_at: string;
  capacity: string;
  confirmation_window_hours: string;
  ask_shirt_size: boolean;
  ask_food_intolerances: boolean;
  grants_role_ids: string[];
};

const EMPTY: CreateValues = {
  name: "",
  open_at: "",
  close_at: "",
  capacity: "",
  confirmation_window_hours: "168",
  ask_shirt_size: false,
  ask_food_intolerances: false,
  grants_role_ids: [],
};

export default function NewApplicationFormPage() {
  const router = useRouter();
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const [roles, setRoles] = useState<RoleSummary[]>([]);

  useEffect(() => {
    // A protected role (system:superadmin today, CLI-only, H8) is never
    // offerable as a grantable role — the assign route would 403 it anyway.
    api
      .get<RoleSummary[]>("/api/roles")
      .then((r) => setRoles(r.filter((role) => !role.isProtected)))
      .catch(() => setRoles([]));
  }, []);

  const localizedCreateSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
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

  const form = useForm<CreateValues>({
    resolver: zodResolver(localizedCreateSchema),
    defaultValues: EMPTY,
  });

  async function onCreate(values: CreateValues) {
    const capacityNum = values.capacity.trim() ? Number(values.capacity) : null;
    if (capacityNum !== null && (!Number.isInteger(capacityNum) || capacityNum < 1)) {
      form.setError("capacity", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    const windowHours = values.confirmation_window_hours.trim()
      ? Number(values.confirmation_window_hours)
      : 168;
    if (!Number.isInteger(windowHours) || windowHours < 1) {
      form.setError("confirmation_window_hours", { message: t("mustBePositiveWholeNumber") });
      return;
    }
    try {
      // POST /api/applications (APPLICATIONS_MANAGE). Template starts empty; the
      // questions editor on the detail page fills it in (H11).
      const created = await api.post<ApplicationForm>("/api/applications", {
        name: values.name.trim(),
        template: [],
        open_at: fromLocalInput(values.open_at),
        close_at: fromLocalInput(values.close_at),
        capacity: capacityNum,
        confirmation_window_hours: windowHours,
        ask_shirt_size: values.ask_shirt_size,
        ask_food_intolerances: values.ask_food_intolerances,
        grants_role_ids: values.grants_role_ids.map(Number),
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
      <BackLink href="/applications" label={t("backToApplications")} />

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
            <FormField
              control={form.control}
              name="ask_shirt_size"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
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
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="ask_food_intolerances"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                    <div>
                      <FormLabel className="font-normal">{t("askFoodIntolerancesLabel")}</FormLabel>
                      <FormDescription>{t("askFoodIntolerancesDesc")}</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </div>
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
            <FormField
              control={form.control}
              name="grants_role_ids"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("grantsRolesLabel")}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
                      value={field.value}
                      onChange={(next) => {
                        field.onChange(next);
                        // Re-suggest the logistics defaults from the roles
                        // actually being granted (H8) — still just a
                        // starting point, editable below. Replaces the
                        // retired static `type`-keyed default; matches by
                        // name against the default seed roles' own names
                        // ("Participant"/"Mentor") since there's no fixed
                        // category to key off anymore.
                        const selectedNames = new Set(
                          roles
                            .filter((role) => next.includes(String(role.id)))
                            .map((role) => role.name.toLowerCase()),
                        );
                        const asksByDefault =
                          selectedNames.has("participant") || selectedNames.has("mentor");
                        form.setValue("ask_shirt_size", asksByDefault);
                        form.setValue("ask_food_intolerances", asksByDefault);
                      }}
                      placeholder={t("grantsRolesPlaceholder")}
                      searchPlaceholder={t("searchRolesPlaceholder")}
                      emptyText={t("noRolesYet")}
                    />
                  </FormControl>
                  <FormDescription>{t("grantsRolesDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
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
                control={form.control}
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
          </SectionCard>
        </form>
      </Form>
    </div>
  );
}
