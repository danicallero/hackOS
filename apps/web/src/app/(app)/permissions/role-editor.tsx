"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronDownIcon,
  KeyRoundIcon,
  LockIcon,
  SearchIcon,
  Trash2Icon,
  UserPlusIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { TabBar } from "@/components/common/tab-bar";
import { type UserOption, UserPicker } from "@/components/common/user-picker";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { type Translate, useLocale } from "@/lib/i18n";
import type { PermissionState, RoleSummary, UserListItem } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { cn } from "@/lib/utils";
import { filterCapabilitiesByDomain, prettifyCapability, userDisplayName } from "./helpers";

const SUPERADMIN_NAME = "system:superadmin";
const STATE_ORDER: PermissionState[] = ["deny", "inherit", "allow"];

const detailsSchema = (t: Translate) =>
  z.object({
    name: z.string().min(1, t("required")).max(200),
    isVisible: z.boolean(),
  });
type DetailsValues = z.infer<ReturnType<typeof detailsSchema>>;

type CapabilityStateMap = Record<string, PermissionState>;

function toStateMap(role: RoleSummary): CapabilityStateMap {
  const map: CapabilityStateMap = {};
  for (const { capability, state } of role.capabilities) map[capability] = state;
  return map;
}

/**
 * The right-hand editor panel of the Discord-style master-detail roles page
 * (H8): Display / Permissions / Manage members tabs for one selected role.
 * Every save calls back into the parent, which owns the roles list and
 * re-syncs this role in place — this component holds only in-progress edits.
 */
export function RoleEditor({
  role,
  users,
  onSaveDetails,
  onSaveCapabilities,
  onAddMember,
  onRemoveMember,
  onDelete,
  searchUsers,
}: {
  role: RoleSummary;
  users: Map<number, UserListItem>;
  onSaveDetails: (values: { name: string; isVisible: boolean }) => Promise<void>;
  onSaveCapabilities: (
    capabilities: { capability: string; state: PermissionState }[],
  ) => Promise<void>;
  onAddMember: (userId: number, user?: UserListItem) => Promise<void>;
  onRemoveMember: (userId: number) => Promise<void>;
  onDelete: () => Promise<void>;
  searchUsers: (query: string) => Promise<UserOption[]>;
}) {
  const { t } = useLocale();
  const { tab, setTab } = useUrlTab({
    values: ["display", "capabilities", "members"] as const,
    defaultValue: "display",
    aliases: { overview: "display", advanced: "display" },
  });

  const isSuperadmin = role.name === SUPERADMIN_NAME;

  const schema = detailsSchema(t);
  const form = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: role.name, isVisible: role.isVisible },
  });
  const { reset } = form;
  useEffect(() => {
    reset({ name: role.name, isVisible: role.isVisible });
  }, [role, reset]);

  const [caps, setCaps] = useState<CapabilityStateMap>(() => toStateMap(role));
  useEffect(() => {
    setCaps(toStateMap(role));
  }, [role]);
  const [savingCaps, setSavingCaps] = useState(false);
  const [capQuery, setCapQuery] = useState("");
  const capsDirty = JSON.stringify(caps) !== JSON.stringify(toStateMap(role));

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const groups = useMemo(() => filterCapabilitiesByDomain(capQuery, t), [capQuery, t]);

  async function submitDetails(values: DetailsValues) {
    await onSaveDetails(values);
  }

  async function submitCaps() {
    setSavingCaps(true);
    try {
      await onSaveCapabilities(
        Object.entries(caps).map(([capability, state]) => ({ capability, state })),
      );
    } finally {
      setSavingCaps(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="type-page-title text-balance">{role.name}</h1>
        {isSuperadmin && (
          <StatusBadge tone="neutral" dot={false}>
            <LockIcon className="size-3" /> {t("systemRoleBadge")}
          </StatusBadge>
        )}
        {!isSuperadmin && role.isProtected && (
          <StatusBadge tone="neutral" dot={false}>
            {t("protectedRoleBadge")}
          </StatusBadge>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("roleSections")} className="w-full justify-start">
          <TabsTrigger value="display">{t("displayTab")}</TabsTrigger>
          <TabsTrigger value="capabilities">{t("capabilitiesLabel")}</TabsTrigger>
          <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>
        </TabBar>

        <TabsContent value="display" className="space-y-6 pt-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submitDetails)}>
              <SectionCard
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
                    <FormItem className="flex flex-row items-center justify-between gap-2 space-y-0">
                      <FormLabel className="font-normal">{t("isVisibleLabel")}</FormLabel>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          disabled={isSuperadmin}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </SectionCard>
            </form>
          </Form>

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

        <TabsContent value="capabilities" className="pt-2">
          <SectionCard
            icon={KeyRoundIcon}
            title={t("capabilitiesLabel")}
            description={isSuperadmin ? t("superadminLockedDesc") : t("capabilitiesChangeDesc")}
            bodyClassName="p-0"
            footer={
              !isSuperadmin ? (
                <Button onClick={submitCaps} disabled={!capsDirty || savingCaps}>
                  {t("saveCapabilities")}
                </Button>
              ) : undefined
            }
          >
            <div className="relative border-b p-4">
              <SearchIcon className="text-muted-foreground absolute top-1/2 left-7 size-4 -translate-y-1/2" />
              <Input
                value={capQuery}
                onChange={(e) => setCapQuery(e.target.value)}
                placeholder={t("searchCapabilitiesPlaceholder")}
                className="pl-8"
              />
            </div>
            {groups.length === 0 ? (
              <p className="text-muted-foreground p-6 text-sm">{t("noMatchingCapability")}</p>
            ) : (
              <div className="divide-border divide-y">
                {groups.map((group) => (
                  <CapabilityGroup
                    key={group.domain}
                    domain={group.domain}
                    capabilities={group.capabilities}
                    caps={caps}
                    disabled={isSuperadmin}
                    onChange={(cap, state) => setCaps((prev) => ({ ...prev, [cap]: state }))}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="members" className="pt-2">
          <MembersPanel
            role={role}
            users={users}
            disabled={isSuperadmin}
            onAdd={onAddMember}
            onRemove={onRemoveMember}
            search={searchUsers}
          />
        </TabsContent>
      </Tabs>

      <AlertModal
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteRoleQuestionInline", { name: role.name })}
        description={t("permanentlyRemovesRoleDesc")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteRole")}
        destructive
        pending={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function CapabilityGroup({
  domain,
  capabilities,
  caps,
  disabled,
  onChange,
}: {
  domain: string;
  capabilities: string[];
  caps: CapabilityStateMap;
  disabled: boolean;
  onChange: (cap: string, state: PermissionState) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted/50 flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
        >
          <span className="type-label text-muted-foreground">{domain}</span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "text-muted-foreground size-4 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="divide-border divide-y border-t">
        {capabilities.map((cap) => (
          <div key={cap} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{prettifyCapability(cap, t)}</p>
              <p className="text-muted-foreground truncate font-mono text-xs">{cap}</p>
            </div>
            <CapabilityStateControl
              state={caps[cap] ?? "inherit"}
              disabled={disabled}
              onChange={(state) => onChange(cap, state)}
            />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function CapabilityStateControl({
  state,
  disabled,
  onChange,
}: {
  state: PermissionState;
  disabled: boolean;
  onChange: (state: PermissionState) => void;
}) {
  const { t } = useLocale();
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {STATE_ORDER.map((candidate, i) => (
        <button
          key={candidate}
          type="button"
          disabled={disabled}
          onClick={() => onChange(candidate)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            i > 0 && "border-l",
            state === candidate
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground",
          )}
        >
          {t(
            candidate === "allow"
              ? "capabilityStateAllow"
              : candidate === "deny"
                ? "capabilityStateDeny"
                : "capabilityStateInherit",
          )}
        </button>
      ))}
    </div>
  );
}

function MembersPanel({
  role,
  users,
  disabled,
  onAdd,
  onRemove,
  search,
}: {
  role: RoleSummary;
  users: Map<number, UserListItem>;
  disabled: boolean;
  onAdd: (userId: number, user?: UserListItem) => Promise<void>;
  onRemove: (userId: number) => Promise<void>;
  search: (query: string) => Promise<UserOption[]>;
}) {
  const { t } = useLocale();
  const [pickedId, setPickedId] = useState("");
  const [pickedUser, setPickedUser] = useState<UserListItem | null>(null);
  const [adding, setAdding] = useState(false);

  const existingSet = useMemo(() => new Set(role.memberIds), [role.memberIds]);
  const searchExcludingMembers = useMemo(
    () => async (query: string) => (await search(query)).filter((u) => !existingSet.has(u.id)),
    [search, existingSet],
  );

  async function handleAdd() {
    if (!pickedId) return;
    setAdding(true);
    try {
      await onAdd(Number(pickedId), pickedUser ?? undefined);
      setPickedId("");
      setPickedUser(null);
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard
      title={t("membersTitle")}
      description={disabled ? t("superadminLockedDesc") : undefined}
      bodyClassName="p-0"
    >
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <UserPicker
            value={pickedId}
            onChange={(value, user) => {
              setPickedId(value);
              setPickedUser((user as UserListItem | null) ?? null);
            }}
            search={searchExcludingMembers}
            className="min-w-56 flex-1"
          />
          <Button size="sm" disabled={!pickedId || adding} onClick={handleAdd}>
            <UserPlusIcon /> {t("addAction")}
          </Button>
        </div>
      )}
      {role.memberIds.length === 0 ? (
        <p className="text-muted-foreground p-6 text-sm">{t("noMembersYetPeriod")}</p>
      ) : (
        <ul className="divide-border divide-y">
          {role.memberIds.map((id) => {
            const user = users.get(id);
            return (
              <li key={id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {user ? userDisplayName(user, t) : t("userNumberFallback", { id })}
                  </p>
                  {user?.email && (
                    <p className="text-muted-foreground truncate text-xs">{user.email}</p>
                  )}
                </div>
                {!disabled && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(id)}
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
  );
}
