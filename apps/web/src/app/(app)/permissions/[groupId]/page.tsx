"use client";

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  KeyRoundIcon,
  LayersIcon,
  SettingsIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { MultiSelect } from "@/components/common/multi-select";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { useMe } from "@/lib/session";
import type {
  PermissionGroupDetail,
  PermissionGroupSummary,
  UserList,
  UserListItem,
} from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { capabilityOptions, permissionTemplateName, userDisplayName } from "../helpers";
import { AddMemberModal } from "./member-modal";
import { canResetPermissionTemplate } from "./template-reset";
import { TemplateResetSection } from "./template-reset-section";

// H8: group detail — edit name/description, set capabilities, manage members
// and nested included groups. Every mutation hits the permission-group API and
// re-syncs the group in place.

const detailsSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("required")).max(200),
    description: z.string().max(2000),
  });
type DetailsValues = z.infer<ReturnType<typeof detailsSchema>>;

export default function PermissionGroupDetailPage() {
  const { t } = useLocale();
  const me = useMe();
  const router = useRouter();
  const params = useParams<{ groupId: string }>();
  const groupId = Number(params.groupId);
  const { tab, setTab } = useUrlTab({
    values: ["overview", "capabilities", "members", "included", "advanced"] as const,
    defaultValue: "overview",
  });

  const [group, setGroup] = useState<PermissionGroupDetail | null>(null);
  const [allGroups, setAllGroups] = useState<PermissionGroupSummary[]>([]);
  const [users, setUsers] = useState<Map<number, UserListItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [caps, setCaps] = useState<string[]>([]);
  const [savingCaps, setSavingCaps] = useState(false);
  const [includeSel, setIncludeSel] = useState("");
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const schema = detailsSchema(t);
  const form = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "" },
  });
  const { reset } = form;

  const mergeUsers = useCallback((list: UserListItem[]) => {
    setUsers((prev) => {
      const next = new Map(prev);
      for (const u of list) next.set(u.id, u);
      return next;
    });
  }, []);

  const applyGroup = useCallback(
    (g: PermissionGroupDetail) => {
      setGroup(g);
      setCaps(g.capabilities);
      reset({ name: g.name, description: g.description ?? "" });
    },
    [reset],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    const [groupResult, groupsResult, directoryResult] = await Promise.allSettled([
      api.get<PermissionGroupDetail>(`/api/permission-groups/${groupId}`),
      api.get<PermissionGroupSummary[]>("/api/permission-groups"),
      api.get<UserList>("/api/users", { query: { limit: 200 } }),
    ]);

    if (groupResult.status === "rejected") {
      const err = groupResult.reason;
      if (err instanceof ApiError && err.status === 404) {
        setGroup(null);
        setNotFound(true);
      } else {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadGroup");
        setLoadError(message);
        toast.error(message);
      }
    } else {
      applyGroup(groupResult.value);
      if (groupsResult.status === "fulfilled") setAllGroups(groupsResult.value);
      if (directoryResult.status === "fulfilled") mergeUsers(directoryResult.value.users);

      const auxiliaryError =
        groupsResult.status === "rejected"
          ? groupsResult.reason
          : directoryResult.status === "rejected"
            ? directoryResult.reason
            : null;
      if (auxiliaryError) {
        const message =
          auxiliaryError instanceof ApiError ? auxiliaryError.message : t("couldNotLoadGroup");
        setLoadError(message);
        toast.error(message);
      }
    }

    setLoading(false);
  }, [groupId, applyGroup, mergeUsers, t]);

  useEffect(() => {
    if (!Number.isFinite(groupId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setNotFound(true);
      return;
    }
    void load();
  }, [groupId, load]);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this group elsewhere — but never while there's an unsaved capability or
  // details edit in progress, since `load` -> `applyGroup` would silently
  // discard it (reset `caps` and the details form to the server's values).
  const dirtyRef = useRef(false);
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);
  const isFirstLiveRefresh = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (isFirstLiveRefresh.current) {
      isFirstLiveRefresh.current = false;
      return;
    }
    if (dirtyRef.current) return;
    void load();
  }, [liveRefresh, load]);

  async function onSaveDetails(values: DetailsValues) {
    try {
      const g = await api.patch<PermissionGroupDetail>(`/api/permission-groups/${groupId}`, {
        name: values.name,
        description: values.description || null,
      });
      applyGroup(g);
      toast.success(t("groupUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveGroup"));
    }
  }

  async function onSaveCaps() {
    setSavingCaps(true);
    try {
      const g = await api.put<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/capabilities`,
        { capabilities: caps },
      );
      applyGroup(g);
      toast.success(t("capabilitiesSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveCapabilities"));
    } finally {
      setSavingCaps(false);
    }
  }

  async function addInclude(childGroupId: number) {
    try {
      const g = await api.post<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/includes`,
        { childGroupId },
      );
      applyGroup(g);
      toast.success(t("groupIncluded"));
    } catch (err) {
      // 409: would create a cycle (server-enforced, plan/07).
      toast.error(err instanceof ApiError ? err.message : t("couldNotIncludeGroup"));
    }
  }

  async function removeInclude(childGroupId: number) {
    try {
      const g = await api.delete<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/includes/${childGroupId}`,
      );
      applyGroup(g);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveIncludedGroup"));
    }
  }

  async function addMember(userId: number, user?: UserListItem) {
    try {
      const g = await api.post<PermissionGroupDetail>(`/api/permission-groups/${groupId}/members`, {
        userId,
      });
      if (user) mergeUsers([user]);
      applyGroup(g);
      toast.success(t("memberAdded"));
      setAddMemberOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddMemberGroup"));
    }
  }

  async function removeMember(userId: number) {
    try {
      const g = await api.delete<PermissionGroupDetail>(
        `/api/permission-groups/${groupId}/members/${userId}`,
      );
      applyGroup(g);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveMemberGroup"));
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await api.delete<{ deleted: true }>(`/api/permission-groups/${groupId}`);
      toast.success(t("groupDeleted"));
      router.push("/permissions");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteGroup"));
      setDeleting(false);
    }
  }

  const includeOptions = useMemo(
    () => allGroups.filter((g) => g.id !== groupId && !(group?.includes ?? []).includes(g.id)),
    [allGroups, group?.includes, groupId],
  );
  const groupName = (id: number) =>
    allGroups.find((g) => g.id === id)?.name ?? t("groupNumberFallback", { id });

  // Track dirty state so the live-refresh effect can check it without adding
  // a dependency (keeping the effect stable across re-renders).
  useEffect(() => {
    dirtyRef.current =
      (group
        ? caps.length !== group.capabilities.length ||
          caps.some((c) => !group.capabilities.includes(c))
        : false) || form.formState.isDirty;
  }, [group, caps, form.formState.isDirty]);

  if (loading && !group) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("groupNotFoundTitle")} description={t("groupNotFoundDesc")} />
        <Button variant="outline" onClick={() => router.push("/permissions")}>
          <ArrowLeftIcon /> {t("backToPermissions")}
        </Button>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("permissions")} />
        <ContextualError
          message={loadError ?? t("couldNotLoadGroup")}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const capsDirty =
    caps.length !== group.capabilities.length || caps.some((c) => !group.capabilities.includes(c));
  const templateName = group.templateKey ? permissionTemplateName(group.templateKey, t) : null;
  const canResetTemplate = canResetPermissionTemplate(group.templateKey, me?.capabilities ?? []);
  return (
    <div className="space-y-8">
      {/* The parent crumb lives in the header's context slot (issue #297). */}
      <PageHeader
        context={
          <button
            type="button"
            className="hover:text-foreground inline-flex items-center gap-1"
            onClick={() => router.push("/permissions")}
          >
            <ArrowLeftIcon className="size-3" />
            {t("permissions")}
          </button>
        }
        title={group.name}
        description={group.description ?? undefined}
        state={
          templateName ? (
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral" dot={false}>
                {t("basedOnPermissionTemplate", { template: templateName })}
              </StatusBadge>
              <StatusBadge tone={group.templateDrifted ? "warning" : "success"} dot={false}>
                {group.templateDrifted
                  ? t("permissionTemplateDrifted")
                  : t("permissionTemplateCurrent")}
              </StatusBadge>
            </div>
          ) : undefined
        }
      />

      {loadError && <ContextualError message={loadError} onRetry={() => void load()} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("permissionGroupSections")} className="w-full justify-start">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="capabilities">{t("capabilitiesLabel")}</TabsTrigger>
          <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>
          <TabsTrigger value="included">{t("includedGroupsTitle")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("advancedTab")}</TabsTrigger>
        </TabBar>

        <TabsContent value="overview" className="pt-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSaveDetails)}>
              <SectionCard
                icon={SettingsIcon}
                title={t("groupDetailsTitle")}
                footer={
                  <SubmitButton pending={form.formState.isSubmitting}>
                    {t("saveChanges")}
                  </SubmitButton>
                }
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
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
              </SectionCard>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="capabilities" className="pt-2">
          <SectionCard
            icon={KeyRoundIcon}
            title={t("capabilitiesLabel")}
            description={t("capabilitiesChangeDesc")}
            footer={
              <Button onClick={onSaveCaps} disabled={!capsDirty || savingCaps}>
                {savingCaps && <Spinner />}
                {t("saveCapabilities")}
              </Button>
            }
          >
            <MultiSelect
              options={capabilityOptions(t)}
              value={caps}
              onChange={setCaps}
              placeholder={t("selectCapabilitiesPlaceholder")}
              searchPlaceholder={t("searchCapabilitiesPlaceholder")}
              emptyText={t("noMatchingCapability")}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="members" className="pt-2">
          <SectionCard
            icon={UsersIcon}
            title={t("membersTitle")}
            action={
              <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)}>
                <UserPlusIcon /> {t("addMemberLabel")}
              </Button>
            }
            bodyClassName={group.members.length === 0 ? undefined : "p-0"}
          >
            {group.members.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noMembersYetPeriod")}</p>
            ) : (
              <ul className="divide-border divide-y">
                {group.members.map((id) => {
                  const user = users.get(id);
                  return (
                    <li key={id} className="flex items-center justify-between gap-3 px-6 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {user ? userDisplayName(user, t) : t("userNumberFallback", { id })}
                        </p>
                        {user?.email && (
                          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                        )}
                      </div>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember(id)}
                        aria-label={t("removeMemberAria", { id })}
                      >
                        <Trash2Icon />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="included" className="pt-2">
          <SectionCard
            icon={LayersIcon}
            title={t("includedGroupsTitle")}
            description={t("membersInheritDesc")}
            action={
              includeOptions.length > 0 ? (
                <EntityCombobox
                  className="w-48"
                  options={includeOptions}
                  value={includeSel}
                  onChange={(v) => {
                    setIncludeSel("");
                    addInclude(Number(v));
                  }}
                  getId={(g) => g.id}
                  getLabel={(g) => g.name}
                  placeholder={t("includeGroupPlaceholder")}
                />
              ) : undefined
            }
            bodyClassName={group.includes.length === 0 ? undefined : "p-0"}
          >
            {group.includes.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noIncludedGroupsPeriod")}</p>
            ) : (
              <ul className="divide-border divide-y">
                {group.includes.map((id) => (
                  <li key={id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <button
                      type="button"
                      className="truncate text-sm font-medium hover:underline"
                      onClick={() => router.push(`/permissions/${id}`)}
                    >
                      {groupName(id)}
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => removeInclude(id)}
                      aria-label={t("removeIncludedGroupAria", { id })}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-6 pt-2">
          {templateName && (
            <TemplateResetSection
              group={group}
              templateName={templateName}
              canReset={canResetTemplate}
              onGroupUpdated={applyGroup}
            />
          )}
          <SectionCard
            icon={Trash2Icon}
            title={t("dangerZoneTitle")}
            description={t("deletingGroupRemovesDesc")}
            action={
              <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                {t("deleteGroup")}
              </Button>
            }
          >
            <p className="text-muted-foreground text-sm">{t("cannotBeUndoneMembersLose")}</p>
          </SectionCard>
        </TabsContent>
      </Tabs>

      <AddMemberModal
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        existing={group.members}
        onAdd={addMember}
      />

      <AlertModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteGroupQuestionInline", { name: group.name })}
        description={t("permanentlyRemovesGroupDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteGroup")}
        destructive
        pending={deleting}
        onConfirm={onDelete}
      >
        <p className="text-muted-foreground text-sm">
          {t("typeFreeConfirmInline", { name: group.name })}
        </p>
      </AlertModal>
    </div>
  );
}
