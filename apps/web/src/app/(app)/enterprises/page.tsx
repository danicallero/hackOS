"use client";

// Enterprises directory (H43/H44): admins with sponsors:manage list every
// sponsor enterprise and create new ones. An enterprise is created up-front so
// it can be referenced when inviting a sponsor rep, who auto-links to it on
// acceptance. Row click drills into the edit page.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2Icon, EyeIcon, EyeOffIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { formatScheduledDateTime, fromDatetimeLocal } from "@/lib/datetime";
import { LOCALE_CODES, type Translate, useLocale } from "@/lib/i18n";
import { useCan, useMe } from "@/lib/session";
import { type Enterprise, initials, isScheduled, visibilityTone } from "./shared";

// Optional URL: allow blank, otherwise must be a valid URL.
const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
// Optional positive integer typed as text so the input can be cleared.
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});
type CreateValues = z.infer<typeof createSchema>;

function buildColumns(t: Translate, locale: string): Column<Enterprise>[] {
  return [
    {
      id: "name",
      header: t("enterprises"),
      sortValue: (e) => e.name.toLowerCase(),
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            {e.logo_url ? (
              <SponsorLogo
                logoUrl={e.logo_url}
                logoNegativeUrl={e.logo_negative_url}
                alt={e.name}
                className="size-full object-contain"
              />
            ) : (
              <AvatarFallback>{initials(e.name)}</AvatarFallback>
            )}
          </Avatar>
          <span className="font-medium">{e.name}</span>
        </div>
      ),
    },
    {
      id: "website",
      header: t("colWebsite"),
      cell: (e) =>
        e.website ? (
          <span className="text-muted-foreground text-sm">
            {e.website.replace(/^https?:\/\//, "")}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "visibility",
      header: t("colVisibility"),
      sortValue: (e) => e.visibility,
      cell: (e) => (
        <StatusBadge tone={visibilityTone(e.visibility)} className="capitalize">
          {e.visibility}
        </StatusBadge>
      ),
    },
    {
      id: "reveal",
      header: t("colReveal"),
      sortValue: (e) => e.available_from ?? "",
      cell: (e) => {
        if (isScheduled(e.available_from)) {
          return (
            <div className="flex items-center gap-2">
              <StatusBadge tone="warning">{t("dataStatusScheduled")}</StatusBadge>
              <span className="text-muted-foreground text-sm">
                {formatScheduledDateTime(e.available_from as string, locale)}
              </span>
            </div>
          );
        }
        if (e.visibility === "visible") {
          return (
            <span className="text-muted-foreground text-sm">
              {e.available_from
                ? formatScheduledDateTime(e.available_from, locale)
                : t("immediate")}
            </span>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
    {
      id: "priority",
      header: t("priorityLabel"),
      align: "right",
      sortValue: (e) => e.display_priority ?? Number.POSITIVE_INFINITY,
      cell: (e) =>
        e.display_priority != null ? (
          <span className="text-sm">{e.display_priority}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];
}

export default function EnterprisesPage() {
  const { t, language } = useLocale();
  const router = useRouter();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const me = useMe();
  const [enterprises, setEnterprises] = useState<Enterprise[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sponsorRetryNonce, setSponsorRetryNonce] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const columns = useMemo(() => buildColumns(t, LOCALE_CODES[language]), [t, language]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.get<{ enterprises: Enterprise[] }>("/api/enterprises");
      setEnterprises(r.enterprises);
      setSelectedIds(new Set());
    } catch (err) {
      setEnterprises([]);
      const message = err instanceof ApiError ? err.message : t("couldNotLoadEnterprises");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  const bulkVisibility = useCallback(
    async (visible: boolean) => {
      const ids = [...selectedIds].map(Number);
      if (ids.length === 0) return;
      setBulkBusy(true);
      try {
        await api.post("/api/enterprises/visibility", { ids, visible });
        toast.success(
          visible
            ? ids.length === 1
              ? t("madeVisibleEnterpriseOne", { count: ids.length })
              : t("madeVisibleEnterpriseOther", { count: ids.length })
            : ids.length === 1
              ? t("hidEnterpriseOne", { count: ids.length })
              : t("hidEnterpriseOther", { count: ids.length }),
        );
        await load();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : t("couldNotUpdateVisibility"));
      } finally {
        setBulkBusy(false);
      }
    },
    [selectedIds, load, t],
  );

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits an enterprise elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (canManage) {
      void load();
      return;
    }
    if (!me?.isSponsorRep) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    api
      .get<Enterprise>("/api/enterprises/mine")
      .then((enterprise) => {
        if (alive) router.replace(`/enterprises/${enterprise.id}`);
      })
      .catch((err) => {
        if (!alive) return;
        const message = err instanceof ApiError ? err.message : t("couldNotLoadYourEnterprise");
        setLoadError(message);
        toast.error(message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [canManage, load, me?.role, router, liveRefresh, sponsorRetryNonce, t]);

  if (!canManage && me?.isSponsorRep && loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("myEnterprise")} />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(e) => String(e.id)}
          loading
          empty={{ icon: Building2Icon, title: t("loadingEnterprise") }}
        />
      </div>
    );
  }

  if (!canManage && me?.isSponsorRep && loadError) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("myEnterprise")} />
        <DataTable
          columns={columns}
          data={[]}
          getRowId={(enterprise) => String(enterprise.id)}
          error={{
            message: loadError,
            onRetry: () => setSponsorRetryNonce((value) => value + 1),
          }}
        />
      </div>
    );
  }

  if (!canManage) {
    return <AccessDenied ask={t("sponsorsAccessDeniedDesc")} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("enterprises")}
        description={t("enterprisesDesc")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon className="size-4" />
            {t("newEnterprise")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={enterprises}
        getRowId={(e) => String(e.id)}
        getRowHref={(e) => `/enterprises/${e.id}`}
        getRowLabel={(e) => e.name}
        searchable={(e) => `${e.name} ${e.website ?? ""}`}
        searchPlaceholder={t("searchEnterprisesPlaceholder")}
        pageSize={15}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={
          selectedIds.size > 0 ? (
            <>
              <span className="text-muted-foreground text-sm">
                {t("selectedCount", { count: selectedIds.size })}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(true)}
              >
                <EyeIcon className="size-4" />
                {t("makeVisible")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulkBusy}
                onClick={() => bulkVisibility(false)}
              >
                <EyeOffIcon className="size-4" />
                {t("hide")}
              </Button>
            </>
          ) : undefined
        }
        empty={{
          icon: Building2Icon,
          title: t("noEnterprisesYetTitle"),
          description: t("createFirstSponsorEnterprise"),
        }}
      />

      <CreateEnterpriseModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (created) => {
          setCreateOpen(false);
          await load();
          router.push(`/enterprises/${created.id}`);
        }}
      />
    </div>
  );
}

function CreateEnterpriseModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: Enterprise) => void | Promise<void>;
}) {
  const { t } = useLocale();
  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      website: "",
      logoUrl: "",
      logoNegativeUrl: "",
      description: "",
      tierId: "",
      displayPriority: "",
      visibility: "hidden",
      availableFrom: "",
    },
  });
  const { reset } = form;

  // Reset the form each time the modal opens so stale input never lingers.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  async function onSubmit(values: CreateValues) {
    try {
      // POST /api/enterprises (createEnterpriseBody). Empty strings → null so
      // optional fields are omitted; availableFrom is coerced to a Date server-side.
      const created = await api.post<Enterprise>("/api/enterprises", {
        name: values.name,
        website: values.website || null,
        logoUrl: values.logoUrl || null,
        logoNegativeUrl: values.logoNegativeUrl || null,
        description: values.description || null,
        tierId: values.tierId ? Number(values.tierId) : null,
        displayPriority: values.displayPriority ? Number(values.displayPriority) : null,
        visibility: values.visibility,
        availableFrom: fromDatetimeLocal(values.availableFrom),
      });
      toast.success(t("enterpriseCreated"));
      await onCreated(created);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateEnterprise"));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      icon={Building2Icon}
      title={t("newEnterprise")}
      description={t("newEnterpriseModalDesc")}
      footer={
        <SubmitButton form="create-enterprise-form" pending={form.formState.isSubmitting}>
          {t("createEnterprise")}
        </SubmitButton>
      }
    >
      <Form {...form}>
        <form
          id="create-enterprise-form"
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-5"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("name")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("acmeCorpPlaceholder")} {...field} />
                </FormControl>
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
                  <Input type="url" placeholder="https://acme.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="logoUrl"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("logoUrlLabel")}</FormLabel>
                <FormControl>
                  <Input type="url" placeholder="https://…/logo.png" {...field} />
                </FormControl>
                <FormDescription>{t("optionalUploadLater")}</FormDescription>
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
                  <Input type="url" placeholder="https://…/logo-negative.png" {...field} />
                </FormControl>
                <FormDescription>{t("regularLogoUsedDesc")}</FormDescription>
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
                  <Textarea rows={3} placeholder={t("whatSponsorDoesPlaceholder")} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="tierId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("tierIdLabel")}</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder={`${t("egPrefix")} 1`} {...field} />
                  </FormControl>
                  <FormDescription>{t("tierReferenceOptionalDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayPriority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("displayPriorityLabel")}</FormLabel>
                  <FormControl>
                    <Input inputMode="numeric" placeholder="1 = first" {...field} />
                  </FormControl>
                  <FormDescription>{t("lowerShowsFirstDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("colVisibility")}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="hidden">{t("hiddenOption")}</SelectItem>
                    <SelectItem value="visible">{t("visibleLabel")}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="availableFrom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("revealFromLabel")}</FormLabel>
                <FormControl>
                  <DateTimeInput
                    value={field.value}
                    onChange={(value) =>
                      form.setValue("availableFrom", value, { shouldDirty: true })
                    }
                    nullOption={{ label: t("immediate") }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </Modal>
  );
}
