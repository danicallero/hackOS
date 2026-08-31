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
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
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
import { type Translate, useLocale } from "@/lib/i18n";
import type { RoleDetail, RoleSummary, RoleTemplate } from "@/lib/types";
import { capabilitiesByDomain, permissionTemplateName, prettifyCapability } from "./helpers";

// H8: admins manage a Discord-style role hierarchy. This page lists roles by
// position, offers a create-role modal (optionally seeded from a template),
// and shows the read-only catalogue of every capability kind.

const createSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("required")).max(200),
    position: z
      .string()
      .min(1, t("required"))
      .refine((v) => Number.isInteger(Number(v)), t("required")),
    isVisible: z.boolean(),
    templateKey: z.string(),
  });

type CreateValues = z.infer<ReturnType<typeof createSchema>>;

export default function PermissionsPage() {
  const { t } = useLocale();
  const router = useRouter();
  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);

  const schema = createSchema(t);
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", position: "0", isVisible: true, templateKey: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [rolesResult, templatesResult] = await Promise.allSettled([
      api.get<RoleSummary[]>("/api/roles"),
      api.get<RoleTemplate[]>("/api/role-templates"),
    ]);
    if (rolesResult.status === "fulfilled") {
      setRoles(rolesResult.value);
    } else {
      setLoadError(
        rolesResult.reason instanceof ApiError
          ? rolesResult.reason.message
          : t("couldNotLoadRoles"),
      );
    }
    if (templatesResult.status === "fulfilled") setTemplates(templatesResult.value);
    setLoading(false);
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a role elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=identity", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, liveRefresh]);

  async function onCreate(values: CreateValues) {
    const template = templates.find((tpl) => tpl.key === values.templateKey);
    try {
      const role = await api.post<RoleDetail>("/api/roles", {
        name: values.name,
        position: Number(values.position),
        isVisible: values.isVisible,
        templateKey: template?.key,
      });
      toast.success(t("roleCreated"));
      setCreateOpen(false);
      form.reset({ name: "", position: "0", isVisible: true, templateKey: "" });
      router.push(`/permissions/${role.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRole"));
    }
  }

  const columns: Column<RoleSummary>[] = [
    {
      id: "name",
      header: t("name"),
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          {r.name}
          {r.isProtected && (
            <StatusBadge tone="neutral" dot={false}>
              {t("protectedRoleBadge")}
            </StatusBadge>
          )}
        </span>
      ),
      sortValue: (r) => r.name,
    },
    {
      id: "position",
      header: t("positionLabel"),
      cell: (r) => <span className="tabular-nums">{r.position}</span>,
      sortValue: (r) => r.position,
    },
    {
      id: "members",
      header: t("membersTitle"),
      cell: (r) => <span className="tabular-nums">{r.memberIds.length}</span>,
      sortValue: (r) => r.memberIds.length,
    },
  ];

  const catalogue = capabilitiesByDomain();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("rolesTitle")}
        primaryAction={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon /> {t("newRole")}
          </Button>
        }
      />

      <SectionCard icon={ShieldCheckIcon} title={t("rolesTitle")} bodyClassName="p-0">
        <DataTable
          columns={columns}
          data={[...roles].sort((a, b) => b.position - a.position)}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={loadError ? { message: loadError, onRetry: load } : undefined}
          searchable={(r) => r.name}
          searchPlaceholder={t("filterRolesPlaceholder")}
          pageSize={20}
          getRowHref={(r) => `/permissions/${r.id}`}
          getRowLabel={(r) => r.name}
          empty={{
            icon: ShieldCheckIcon,
            title: t("noRolesYetTitle"),
            action: (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                <PlusIcon aria-hidden="true" />
                {t("createRole")}
              </Button>
            ),
          }}
        />
      </SectionCard>

      <SectionCard icon={LayersIcon} title={t("capabilitiesCatalogueTitle")}>
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
        title={t("newRole")}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("cancel")}
            </Button>
            <SubmitButton form="create-role-form" pending={form.formState.isSubmitting}>
              {t("createRole")}
            </SubmitButton>
          </>
        }
      >
        <Form {...form}>
          <form id="create-role-form" onSubmit={form.handleSubmit(onCreate)} className="space-y-5">
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
              name="position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("positionLabel")}</FormLabel>
                  <FormControl>
                    <Input type="number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isVisible"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="font-normal">{t("isVisibleLabel")}</FormLabel>
                </FormItem>
              )}
            />
            {templates.length > 0 && (
              <FormField
                control={form.control}
                name="templateKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("permissionTemplate")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("noneOptionLabel")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="">{t("noneOptionLabel")}</SelectItem>
                        {templates.map((template) => (
                          <SelectItem key={template.key} value={template.key}>
                            {permissionTemplateName(template, t)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>
      </Modal>
    </div>
  );
}
