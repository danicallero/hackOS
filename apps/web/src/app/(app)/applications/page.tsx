"use client";

// Application forms directory (H11-H14): manage, review, and decision holders
// share the protected list. Only applications:manage can create a form or
// reach the builder controls on its detail page.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { RoleSummary } from "@/lib/types";
import {
  APPLICATION_TYPES,
  type ApplicationForm,
  DEFAULT_SHIRT_DIETARY_TYPES,
  fmtDateTime,
  fromLocalInput,
  windowState,
} from "./lib";

const CREATE_FORM_ID = "application-create-form";

// Runtime validator is built inside the component with useMemo so its error
// message can be localized via t("required"). Type is defined separately.
type CreateValues = {
  name: string;
  type: (typeof APPLICATION_TYPES)[number];
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
  type: "participant",
  open_at: "",
  close_at: "",
  capacity: "",
  confirmation_window_hours: "168",
  ask_shirt_size: DEFAULT_SHIRT_DIETARY_TYPES.includes("participant"),
  ask_food_intolerances: DEFAULT_SHIRT_DIETARY_TYPES.includes("participant"),
  grants_role_ids: [],
};

export default function ApplicationsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const [forms, setForms] = useState<ApplicationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [roles, setRoles] = useState<RoleSummary[]>([]);

  const localizedCreateSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        type: z.enum(APPLICATION_TYPES),
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

  useEffect(() => {
    if (!creating) return;
    // system:superadmin is CLI-only (H8) — never offer it as a grantable role.
    api
      .get<RoleSummary[]>("/api/roles")
      .then((r) => setRoles(r.filter((role) => role.name !== "system:superadmin")))
      .catch(() => setRoles([]));
  }, [creating]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // The API admits manage, review, and decide holders. It never infers
      // builder permission merely from access to this directory.
      const { applications } = await api.get<{ applications: ApplicationForm[] }>(
        "/api/applications",
      );
      setForms(applications);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadApplicationForms");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a form elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the applications list from the API on mount is a legitimate external-system sync
    load();
  }, [load, liveRefresh]);

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
        type: values.type,
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
      setCreating(false);
      form.reset(EMPTY);
      router.push(`/applications/${created.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateForm"));
    }
  }

  const columns: Column<ApplicationForm>[] = [
    {
      id: "name",
      header: t("colForm"),
      sortValue: (f) => f.name.toLowerCase(),
      cell: (f) => (
        <div className="space-y-0.5">
          <div className="font-medium">{f.name}</div>
          <div className="text-muted-foreground text-xs">
            {f.template.length === 1
              ? t("questionCountOne", { count: f.template.length })
              : t("questionCountOther", { count: f.template.length })}
          </div>
        </div>
      ),
    },
    {
      id: "type",
      header: t("colType"),
      sortValue: (f) => f.type,
      cell: (f) => <span className="text-sm capitalize">{f.type}</span>,
    },
    {
      id: "status",
      header: t("colWindow"),
      cell: (f) => {
        const w = windowState(f, t);
        return (
          <StatusBadge tone={w.tone} dot={false}>
            {w.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "opens",
      header: t("colOpens"),
      sortValue: (f) => f.open_at ?? "",
      cell: (f) => <span className="text-muted-foreground text-sm">{fmtDateTime(f.open_at)}</span>,
    },
    {
      id: "closes",
      header: t("colCloses"),
      sortValue: (f) => f.close_at ?? "",
      cell: (f) => <span className="text-muted-foreground text-sm">{fmtDateTime(f.close_at)}</span>,
    },
    {
      id: "capacity",
      header: t("colQuota"),
      align: "right",
      sortValue: (f) => f.capacity ?? Number.MAX_SAFE_INTEGER,
      cell: (f) => (
        <span className="text-sm">{f.capacity != null ? f.capacity : t("unlimitedDash")}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("applications")}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t("newForm")}
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={forms}
        getRowId={(f) => String(f.id)}
        stateKey="applications-list"
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        getRowHref={(f) => `/applications/${f.id}`}
        getRowLabel={(f) => f.name}
        searchable={(f) => `${f.name} ${f.type}`}
        searchPlaceholder={t("searchFormsPlaceholder")}
        empty={{
          icon: ClipboardListIcon,
          title: t("noApplicationFormsYet"),
          description: canManage ? t("createFirstFormDesc") : t("formsWillAppear"),
          action: canManage ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden="true" />
              {t("newForm")}
            </Button>
          ) : undefined,
        }}
      />

      <Modal
        open={creating}
        onOpenChange={(o) => {
          setCreating(o);
          if (!o) form.reset(EMPTY);
        }}
        icon={ClipboardListIcon}
        title={t("newApplicationForm")}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton form={CREATE_FORM_ID} pending={form.formState.isSubmitting}>
              {t("createForm")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id={CREATE_FORM_ID} onSubmit={form.handleSubmit(onCreate)} className="space-y-5">
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("personTypeLabel")}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      // Re-suggest the logistics defaults for the new type —
                      // still just a starting point, editable below.
                      const asksByDefault = DEFAULT_SHIRT_DIETARY_TYPES.includes(
                        value as CreateValues["type"],
                      );
                      form.setValue("ask_shirt_size", asksByDefault);
                      form.setValue("ask_food_intolerances", asksByDefault);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full capitalize">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {APPLICATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t} className="capitalize">
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      inDialog
                      options={roles.map((role) => ({ value: String(role.id), label: role.name }))}
                      value={field.value}
                      onChange={field.onChange}
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
          </form>
        </Form>
      </Modal>
    </div>
  );
}
