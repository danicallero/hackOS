"use client";

// Application forms directory (H11): admins with applications:manage define
// forms per person type, each with an open/close window and optional quota.
// Rows link to the detail page (form editor + responses/review/decisions).
// List data: GET /api/applications (APPLICATIONS_MANAGE). Create: POST
// /api/applications with an empty template — questions are added in detail.

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
import { Modal } from "@/components/common/modal";
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
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import {
  APPLICATION_TYPES,
  type ApplicationForm,
  fmtDateTime,
  fromLocalInput,
  windowState,
} from "./lib";

const CREATE_FORM_ID = "application-create-form";

// Module-level schema kept only for type inference (z.infer); the runtime
// validator used by the form is built inside the component with useMemo so
// its error message can be localized via t("required").
const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  type: z.enum(APPLICATION_TYPES),
  open_at: z.string(),
  close_at: z.string(),
  capacity: z.string(),
  confirmation_window_hours: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

const EMPTY: CreateValues = {
  name: "",
  type: "participant",
  open_at: "",
  close_at: "",
  capacity: "",
  confirmation_window_hours: "168",
};

export default function ApplicationsPage() {
  const router = useRouter();
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const [forms, setForms] = useState<ApplicationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const localizedCreateSchema = useMemo(
    () =>
      z.object({
        name: z.string().min(1, t("required")).max(200),
        type: z.enum(APPLICATION_TYPES),
        open_at: z.string(),
        close_at: z.string(),
        capacity: z.string(),
        confirmation_window_hours: z.string(),
      }),
    [t],
  );

  const form = useForm<CreateValues>({
    resolver: zodResolver(localizedCreateSchema),
    defaultValues: EMPTY,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { applications } = await api.get<{ applications: ApplicationForm[] }>(
        "/api/applications",
      );
      setForms(applications);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadApplicationForms"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a form elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
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
        description={t("applicationsDesc")}
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
        loading={loading}
        onRowClick={(f) => router.push(`/applications/${f.id}`)}
        searchable={(f) => `${f.name} ${f.type}`}
        searchPlaceholder={t("searchFormsPlaceholder")}
        empty={{
          icon: ClipboardListIcon,
          title: t("noApplicationFormsYet"),
          description: canManage ? t("createFirstFormDesc") : t("formsWillAppear"),
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
        description={t("newApplicationFormDesc")}
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
                  <Select onValueChange={field.onChange} value={field.value}>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="open_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("colOpens")}</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormDescription>{t("blankOpenNow")}</FormDescription>
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
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormDescription>{t("blankNeverCloses")}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
                    <FormDescription>{t("hoursToConfirmDesc")}</FormDescription>
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
