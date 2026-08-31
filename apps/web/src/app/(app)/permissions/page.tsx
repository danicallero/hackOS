"use client";

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, PlusIcon, ShieldCheckIcon, Trash2Icon, UndoIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import type { UserOption } from "@/components/common/user-picker";
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
import { Section } from "@/components/ui/surface";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import type {
  PermissionState,
  RoleDetail,
  RoleSeedDiff,
  RoleSummary,
  RoleTemplate,
  UserList,
  UserListItem,
} from "@/lib/types";
import { permissionTemplateName } from "./helpers";
import { RoleEditor } from "./role-editor";
import { RoleList } from "./role-list";

// H8: admins manage a Discord-style hierarchical role model on a single
// master-detail page — the left column lists every role on one reorderable
// hierarchy, the right column edits whichever role is selected (persisted as
// ?role=<id> for deep links, e.g. from a user's permissions tab). This
// replaced a separate full-page /permissions/[roleId] route per the design
// review: selecting a role should feel like flipping a tab, not navigating
// away from the list.

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
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [users, setUsers] = useState<Map<number, UserListItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [deletedRoles, setDeletedRoles] = useState<RoleSummary[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const selectedId = (() => {
    const raw = searchParams.get("role");
    return raw && Number.isFinite(Number(raw)) ? Number(raw) : null;
  })();

  function selectRole(id: number | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === null) params.delete("role");
    else params.set("role", String(id));
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname);
  }

  const mergeUsers = useCallback((list: UserListItem[]) => {
    setUsers((prev) => {
      const next = new Map(prev);
      for (const u of list) next.set(u.id, u);
      return next;
    });
  }, []);

  const schema = createSchema(t);
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", position: "0", isVisible: true, templateKey: "" },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [rolesResult, templatesResult, usersResult] = await Promise.allSettled([
      api.get<RoleSummary[]>("/api/roles"),
      api.get<RoleTemplate[]>("/api/role-templates"),
      api.get<UserList>("/api/users", { query: { limit: 200 } }),
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
    if (usersResult.status === "fulfilled") mergeUsers(usersResult.value.users);
    setLoading(false);
  }, [t, mergeUsers]);

  const loadTrash = useCallback(async () => {
    setTrashLoading(true);
    try {
      const all = await api.get<RoleSummary[]>("/api/roles", { query: { includeDeleted: true } });
      setDeletedRoles(all.filter((r) => r.deletedAt !== null));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotLoadRoles"));
    } finally {
      setTrashLoading(false);
    }
  }, [t]);

  function toggleTrash() {
    const next = !showTrash;
    setShowTrash(next);
    if (next) void loadTrash();
  }

  async function restoreRole(roleId: number) {
    setRestoringId(roleId);
    try {
      await api.post<RoleDetail>(`/api/roles/${roleId}/restore`, {});
      toast.success(t("roleRestored"));
      setDeletedRoles((prev) => prev.filter((r) => r.id !== roleId));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRestoreRole"));
    } finally {
      setRestoringId(null);
    }
  }

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a role elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=identity", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, liveRefresh]);

  function applyRole(updated: RoleSummary) {
    setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

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
      setRoles((prev) => [...prev, role]);
      selectRole(role.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotCreateRole"));
    }
  }

  async function onReorder(roleId: number, newPosition: number) {
    const before = roles;
    setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, position: newPosition } : r)));
    try {
      const updated = await api.patch<RoleDetail>(`/api/roles/${roleId}/position`, {
        position: newPosition,
      });
      applyRole(updated);
    } catch (err) {
      setRoles(before);
      toast.error(err instanceof ApiError ? err.message : t("couldNotMoveRole"));
    }
  }

  async function onSaveDetails(roleId: number, values: { name: string; isVisible: boolean }) {
    try {
      const r = await api.patch<RoleDetail>(`/api/roles/${roleId}`, values);
      applyRole(r);
      toast.success(t("roleUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveRole"));
    }
  }

  async function onSaveCapabilities(
    roleId: number,
    capabilities: { capability: string; state: PermissionState }[],
  ) {
    try {
      const r = await api.put<RoleDetail>(`/api/roles/${roleId}/capabilities`, { capabilities });
      applyRole(r);
      toast.success(t("capabilitiesSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveCapabilities"));
    }
  }

  async function onAddMember(roleId: number, userId: number, user?: UserListItem) {
    try {
      const r = await api.post<RoleDetail>(`/api/roles/${roleId}/users/${userId}`, {});
      if (user) mergeUsers([user]);
      applyRole(r);
      toast.success(t("memberAdded"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddMemberRole"));
    }
  }

  async function onRemoveMember(roleId: number, userId: number) {
    try {
      const r = await api.delete<RoleDetail>(`/api/roles/${roleId}/users/${userId}`);
      applyRole(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveMemberRole"));
    }
  }

  async function onResetToDefault(roleId: number) {
    try {
      const r = await api.post<RoleDetail>(`/api/roles/${roleId}/reset-to-default`, {});
      applyRole(r);
      toast.success(t("resetToDefaultDone"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotResetRole"));
    }
  }

  async function onDelete(roleId: number) {
    try {
      await api.delete<{ deleted: true }>(`/api/roles/${roleId}`);
      toast.success(t("roleDeleted"));
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      selectRole(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteRole"));
    }
  }

  const searchUsers = useMemo(
    () =>
      async (query: string): Promise<UserOption[]> => {
        const result = await api.get<UserList>("/api/users", {
          query: { q: query || undefined, limit: 20 },
        });
        return result.users;
      },
    [],
  );

  const selectedRole = roles.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("rolesTitle")}
        primaryAction={
          <div className="flex gap-2">
            <Button variant="outline" onClick={toggleTrash}>
              <Trash2Icon /> {t("trashTitle")}
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon /> {t("newRole")}
            </Button>
          </div>
        }
      />

      {showTrash && (
        <SectionCard icon={Trash2Icon} title={t("trashTitle")} bodyClassName="p-0">
          {trashLoading ? (
            <p className="text-muted-foreground p-6 text-sm">…</p>
          ) : deletedRoles.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">{t("noDeletedRoles")}</p>
          ) : (
            <ul className="divide-border divide-y">
              {deletedRoles.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={restoringId === r.id}
                    onClick={() => restoreRole(r.id)}
                  >
                    <UndoIcon /> {t("restoreRole")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {loadError ? (
        <ContextualError message={loadError} onRetry={() => void load()} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
          <Section padding="none" className="overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="size-6" />
              </div>
            ) : roles.length === 0 ? (
              <EmptyState
                icon={ShieldCheckIcon}
                title={t("noRolesYetTitle")}
                action={
                  <Button type="button" onClick={() => setCreateOpen(true)}>
                    <PlusIcon aria-hidden="true" />
                    {t("createRole")}
                  </Button>
                }
              />
            ) : (
              <RoleList
                roles={roles}
                selectedId={selectedId}
                onSelect={selectRole}
                onReorder={onReorder}
              />
            )}
          </Section>

          {selectedRole ? (
            <RoleEditor
              role={selectedRole}
              users={users}
              onSaveDetails={(values) => onSaveDetails(selectedRole.id, values)}
              onSaveCapabilities={(caps) => onSaveCapabilities(selectedRole.id, caps)}
              onAddMember={(userId, user) => onAddMember(selectedRole.id, userId, user)}
              onRemoveMember={(userId) => onRemoveMember(selectedRole.id, userId)}
              onDelete={() => onDelete(selectedRole.id)}
              searchUsers={searchUsers}
              loadSeedDiff={() => api.get<RoleSeedDiff>(`/api/roles/${selectedRole.id}/seed-diff`)}
              onResetToDefault={() => onResetToDefault(selectedRole.id)}
            />
          ) : (
            !loading && (
              <Section>
                <EmptyState icon={ShieldCheckIcon} title={t("selectRoleHint")} />
              </Section>
            )
          )}
        </div>
      )}

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
