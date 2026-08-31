"use client";

import { EVENTS } from "@hackos/shared/events";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  KeyRoundIcon,
  MoveVerticalIcon,
  SettingsIcon,
  Trash2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { PageHeader } from "@/components/common/page-header";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
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
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import type { PermissionState, RoleDetail, UserList, UserListItem } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { capabilitiesByDomain, prettifyCapability, userDisplayName } from "../helpers";
import { AddMemberModal } from "./member-modal";

// H8: role detail — edit name/visibility/position, set the tri-state
// (allow/deny/inherit) per capability, and manage members. Every mutation
// hits the roles API and re-syncs the role in place.

const detailsSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("required")).max(200),
    isVisible: z.boolean(),
  });
type DetailsValues = z.infer<ReturnType<typeof detailsSchema>>;

type CapabilityStateMap = Record<string, PermissionState>;

function toStateMap(role: RoleDetail): CapabilityStateMap {
  const map: CapabilityStateMap = {};
  for (const { capability, state } of role.capabilities) map[capability] = state;
  return map;
}

const STATE_ORDER: PermissionState[] = ["inherit", "allow", "deny"];

export default function RoleDetailPage() {
  const { t } = useLocale();
  const router = useRouter();
  const params = useParams<{ roleId: string }>();
  const roleId = Number(params.roleId);
  const { tab, setTab } = useUrlTab({
    values: ["overview", "capabilities", "members", "advanced"] as const,
    defaultValue: "overview",
  });

  const [role, setRole] = useState<RoleDetail | null>(null);
  const [users, setUsers] = useState<Map<number, UserListItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [caps, setCaps] = useState<CapabilityStateMap>({});
  const [savingCaps, setSavingCaps] = useState(false);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [position, setPosition] = useState(0);
  const [savingPosition, setSavingPosition] = useState(false);

  const schema = detailsSchema(t);
  const form = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", isVisible: true },
  });
  const { reset } = form;

  const mergeUsers = useCallback((list: UserListItem[]) => {
    setUsers((prev) => {
      const next = new Map(prev);
      for (const u of list) next.set(u.id, u);
      return next;
    });
  }, []);

  const applyRole = useCallback(
    (r: RoleDetail) => {
      setRole(r);
      setCaps(toStateMap(r));
      setPosition(r.position);
      reset({ name: r.name, isVisible: r.isVisible });
    },
    [reset],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    const [roleResult, directoryResult] = await Promise.allSettled([
      api.get<RoleDetail>(`/api/roles/${roleId}`),
      api.get<UserList>("/api/users", { query: { limit: 200 } }),
    ]);

    if (roleResult.status === "rejected") {
      const err = roleResult.reason;
      if (err instanceof ApiError && err.status === 404) {
        setRole(null);
        setNotFound(true);
      } else {
        const message = err instanceof ApiError ? err.message : t("couldNotLoadRole");
        setLoadError(message);
        toast.error(message);
      }
    } else {
      applyRole(roleResult.value);
      if (directoryResult.status === "fulfilled") mergeUsers(directoryResult.value.users);
    }

    setLoading(false);
  }, [roleId, applyRole, mergeUsers, t]);

  useEffect(() => {
    if (!Number.isFinite(roleId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setNotFound(true);
      return;
    }
    void load();
  }, [roleId, load]);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this role elsewhere — but never while there's an unsaved edit in
  // progress, since `load` -> `applyRole` would silently discard it.
  const dirtyRef = useRef(false);
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=identity", [EVENTS.DOMAIN_CHANGED]);
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
      const r = await api.patch<RoleDetail>(`/api/roles/${roleId}`, {
        name: values.name,
        isVisible: values.isVisible,
      });
      applyRole(r);
      toast.success(t("roleUpdated"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveRole"));
    }
  }

  async function onSavePosition() {
    setSavingPosition(true);
    try {
      const r = await api.patch<RoleDetail>(`/api/roles/${roleId}/position`, { position });
      applyRole(r);
      toast.success(t("roleMoved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotReorderRole"));
    } finally {
      setSavingPosition(false);
    }
  }

  async function onSaveCaps() {
    setSavingCaps(true);
    try {
      const r = await api.put<RoleDetail>(`/api/roles/${roleId}/capabilities`, {
        capabilities: Object.entries(caps).map(([capability, state]) => ({ capability, state })),
      });
      applyRole(r);
      toast.success(t("capabilitiesSaved"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotSaveCapabilities"));
    } finally {
      setSavingCaps(false);
    }
  }

  async function addMember(userId: number, user?: UserListItem) {
    try {
      const r = await api.post<RoleDetail>(`/api/roles/${roleId}/users/${userId}`, {});
      if (user) mergeUsers([user]);
      applyRole(r);
      toast.success(t("memberAdded"));
      setAddMemberOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotAddMemberRole"));
    }
  }

  async function removeMember(userId: number) {
    try {
      const r = await api.delete<RoleDetail>(`/api/roles/${roleId}/users/${userId}`);
      applyRole(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotRemoveMemberRole"));
    }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      await api.delete<{ deleted: true }>(`/api/roles/${roleId}`);
      toast.success(t("roleDeleted"));
      router.push("/permissions");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotDeleteRole"));
      setDeleting(false);
    }
  }

  // Track dirty state so the live-refresh effect can check it without adding
  // a dependency (keeping the effect stable across re-renders).
  useEffect(() => {
    const capsDirty = role ? JSON.stringify(caps) !== JSON.stringify(toStateMap(role)) : false;
    dirtyRef.current =
      capsDirty || form.formState.isDirty || (role ? position !== role.position : false);
  }, [role, caps, position, form.formState.isDirty]);

  if (loading && !role) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("roleNotFoundTitle")} description={t("roleNotFoundDesc")} />
        <Button variant="outline" onClick={() => router.push("/permissions")}>
          <ArrowLeftIcon /> {t("backToRoles")}
        </Button>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("rolesTitle")} />
        <ContextualError message={loadError ?? t("couldNotLoadRole")} onRetry={() => void load()} />
      </div>
    );
  }

  const capsDirty = JSON.stringify(caps) !== JSON.stringify(toStateMap(role));
  // H8: system:superadmin is CLI-only — the API refuses every mutation on it
  // regardless of the actor's capabilities, so this page locks the same
  // controls rather than let an admin hit a 403 after filling out a form.
  const isSuperadmin = role.name === "system:superadmin";

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
            {t("backToRoles")}
          </button>
        }
        title={role.name}
      />

      {loadError && <ContextualError message={loadError} onRetry={() => void load()} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("roleSections")} className="w-full justify-start">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="capabilities">{t("capabilitiesLabel")}</TabsTrigger>
          <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("advancedTab")}</TabsTrigger>
        </TabBar>

        <TabsContent value="overview" className="space-y-6 pt-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSaveDetails)}>
              <SectionCard
                icon={SettingsIcon}
                title={t("roleDetailsTitle")}
                description={isSuperadmin ? t("superadminLockedDesc") : undefined}
                footer={
                  !isSuperadmin ? (
                    <SubmitButton pending={form.formState.isSubmitting}>
                      {t("saveChanges")}
                    </SubmitButton>
                  ) : undefined
                }
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("name")}</FormLabel>
                      <FormControl>
                        <Input {...field} disabled={isSuperadmin} />
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
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSuperadmin}
                        />
                      </FormControl>
                      <FormLabel className="font-normal">{t("isVisibleLabel")}</FormLabel>
                    </FormItem>
                  )}
                />
              </SectionCard>
            </form>
          </Form>

          <SectionCard
            icon={MoveVerticalIcon}
            title={t("positionLabel")}
            footer={
              !isSuperadmin ? (
                <Button
                  onClick={onSavePosition}
                  disabled={position === role.position || savingPosition}
                >
                  {savingPosition && <Spinner />}
                  {t("saveChanges")}
                </Button>
              ) : undefined
            }
          >
            <Input
              type="number"
              value={position}
              onChange={(e) => setPosition(Number(e.target.value))}
              className="max-w-40"
              disabled={isSuperadmin}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="capabilities" className="pt-2">
          <SectionCard
            icon={KeyRoundIcon}
            title={t("capabilitiesLabel")}
            description={isSuperadmin ? t("superadminLockedDesc") : t("capabilitiesChangeDesc")}
            footer={
              !isSuperadmin ? (
                <Button onClick={onSaveCaps} disabled={!capsDirty || savingCaps}>
                  {savingCaps && <Spinner />}
                  {t("saveCapabilities")}
                </Button>
              ) : undefined
            }
          >
            <div className="space-y-5">
              {capabilitiesByDomain().map((group) => (
                <div key={group.domain} className="space-y-2">
                  <p className="type-label text-muted-foreground">{group.domain}</p>
                  <div className="divide-border divide-y rounded-md border">
                    {group.capabilities.map((cap) => {
                      const state = caps[cap] ?? "inherit";
                      return (
                        <div
                          key={cap}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="min-w-0 truncate text-sm">
                            <span className="font-mono">{cap}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              · {prettifyCapability(cap, t)}
                            </span>
                          </span>
                          <div className="flex gap-1">
                            {STATE_ORDER.map((candidate) => (
                              <Button
                                key={candidate}
                                type="button"
                                size="sm"
                                variant={state === candidate ? "default" : "outline"}
                                disabled={isSuperadmin}
                                onClick={() => setCaps((prev) => ({ ...prev, [cap]: candidate }))}
                              >
                                {t(
                                  candidate === "allow"
                                    ? "capabilityStateAllow"
                                    : candidate === "deny"
                                      ? "capabilityStateDeny"
                                      : "capabilityStateInherit",
                                )}
                              </Button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="members" className="pt-2">
          <SectionCard
            icon={UsersIcon}
            title={t("membersTitle")}
            description={isSuperadmin ? t("superadminLockedDesc") : undefined}
            action={
              !isSuperadmin ? (
                <Button size="sm" variant="outline" onClick={() => setAddMemberOpen(true)}>
                  <UserPlusIcon /> {t("addMemberLabel")}
                </Button>
              ) : undefined
            }
            bodyClassName={role.memberIds.length === 0 ? undefined : "p-0"}
          >
            {role.memberIds.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noMembersYetPeriod")}</p>
            ) : (
              <ul className="divide-border divide-y">
                {role.memberIds.map((id) => {
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
                      {!isSuperadmin && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeMember(id)}
                          aria-label={t("removeMemberAria", { id })}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-6 pt-2">
          <SectionCard
            icon={Trash2Icon}
            title={t("dangerZoneTitle")}
            description={isSuperadmin ? t("superadminLockedDesc") : t("deletingRoleRemovesDesc")}
            action={
              !isSuperadmin ? (
                <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                  {t("deleteRole")}
                </Button>
              ) : undefined
            }
          >
            {!isSuperadmin && (
              <p className="text-muted-foreground text-sm">{t("cannotBeUndoneMembersLoseRole")}</p>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <AddMemberModal
        open={addMemberOpen}
        onOpenChange={setAddMemberOpen}
        existing={role.memberIds}
        onAdd={addMember}
      />

      <AlertModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteRoleQuestionInline", { name: role.name })}
        description={t("permanentlyRemovesRoleDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteRole")}
        destructive
        pending={deleting}
        onConfirm={onDelete}
      >
        <p className="text-muted-foreground text-sm">
          {t("typeFreeConfirmInline", { name: role.name })}
        </p>
      </AlertModal>
    </div>
  );
}
