"use client";

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, LayersIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
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
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { PermissionGroupDetail, PermissionGroupSummary } from "@/lib/types";
import { capabilitiesByDomain, capabilityOptions, prettifyCapability } from "./helpers";

// H8: admins manage capability groups. This page lists groups, offers a
// create-group modal and shows the read-only catalogue of every capability kind.

const createSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  description: z.string().max(2000),
  capabilities: z.array(z.string()),
});

type CreateValues = z.infer<typeof createSchema>;

export default function PermissionsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [groups, setGroups] = useState<PermissionGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const form = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "", capabilities: [] },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await api.get<PermissionGroupSummary[]>("/api/permission-groups");
      setGroups(rows);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadPermissionGroups");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a permission group elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    load();
  }, [load, liveRefresh]);

  async function onCreate(values: CreateValues) {
    try {
      const group = await api.post<PermissionGroupDetail>("/api/permission-groups", {
        name: values.name,
        description: values.description || undefined,
        capabilities: values.capabilities,
      });
      toast.success(t("groupCreated"));
      setCreateOpen(false);
      form.reset({ name: "", description: "", capabilities: [] });
      router.push(`/permissions/${group.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateGroup"));
    }
  }

  const columns: Column<PermissionGroupSummary>[] = [
    {
      id: "name",
      header: t("name"),
      cell: (g) => <span className="font-medium">{g.name}</span>,
      sortValue: (g) => g.name,
    },
    {
      id: "description",
      header: t("descriptionLabel"),
      cell: (g) =>
        g.description ? (
          <span className="text-muted-foreground">{g.description}</span>
        ) : (
          <span className="text-muted-foreground/60 italic">{t("noDescriptionItalic")}</span>
        ),
    },
  ];

  const catalogue = capabilitiesByDomain();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("permissions")}
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> {t("newGroup")}
          </Button>
        }
      />

      <SectionCard icon={ShieldCheckIcon} title={t("permissionGroupsTitle")} bodyClassName="p-0">
        <DataTable
          columns={columns}
          data={groups}
          getRowId={(g) => String(g.id)}
          loading={loading}
          error={loadError ? { message: loadError, onRetry: load } : undefined}
          searchable={(g) => `${g.name} ${g.description ?? ""}`}
          searchPlaceholder={t("filterGroupsPlaceholder")}
          pageSize={10}
          onRowClick={(g) => router.push(`/permissions/${g.id}`)}
          getRowLabel={(g) => g.name}
          empty={{
            icon: ShieldCheckIcon,
            title: t("noPermissionGroupsYetTitle"),
            description: t("createGroupToStart"),
            action: (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <PlusIcon aria-hidden="true" />
                {t("createGroup")}
              </Button>
            ),
          }}
        />
      </SectionCard>

      <SectionCard
        icon={LayersIcon}
        title={t("capabilitiesCatalogueTitle")}
        description={t("capabilitiesCatalogueDesc")}
      >
        <div className="space-y-5">
          {catalogue.map((group) => (
            <div key={group.domain} className="space-y-2">
              <p className="type-label text-muted-foreground">{group.domain}</p>
              <div className="flex flex-wrap gap-2">
                {group.capabilities.map((cap) => (
                  <StatusBadge key={cap} tone={cap === "*" ? "brand" : "neutral"} dot={false}>
                    <span className="font-mono">{cap}</span>
                    <span className="text-muted-foreground">· {prettifyCapability(cap, t)}</span>
                  </StatusBadge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        icon={KeyRoundIcon}
        title={t("newPermissionGroupTitle")}
        description={t("giveNameOptionalCapsDesc")}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton form="create-group-form" pending={form.formState.isSubmitting}>
              {t("createGroup")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id="create-group-form" onSubmit={form.handleSubmit(onCreate)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("name")}</FormLabel>
                  <FormControl>
                    <Input placeholder={`${t("egPrefix")} Judges`} {...field} />
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
                    <Textarea rows={3} placeholder={t("whatGroupForPlaceholder")} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="capabilities"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("capabilitiesLabel")}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      inDialog
                      options={capabilityOptions(t)}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t("selectCapabilitiesPlaceholder")}
                      searchPlaceholder={t("searchCapabilitiesPlaceholder")}
                      emptyText={t("noMatchingCapability")}
                    />
                  </FormControl>
                  <FormDescription>{t("canChangeLaterDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      </Modal>
    </div>
  );
}
