"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  History,
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
import { type MessageKey, type Translate, useLocale } from "@/lib/i18n";
import type { PermissionState, RoleSeedDiff, RoleSummary, UserListItem } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { cn } from "@/lib/utils";
import {
  capabilityDescription,
  filterCapabilitiesByDomain,
  prettifyCapability,
  userDisplayName,
} from "./helpers";

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
 * The right-hand editor panel of the multi-role hierarchy's master-detail roles page
 * (H8): Display / Permissions / Manage members tabs for one selected role.
 * Every save calls back into the parent, which owns the roles list and
 * re-syncs this role in place — this component holds only in-progress edits.
 *
 * Below the `md` breakpoint (`mobile`), the same state/hooks instead drive a
 * drill-down presentation (role screen → Permissions/Members sub-screens via
 * `tab`, back via `onBack`) matching this page's narrow-viewport layout —
 * see `page.tsx`. Nothing here forks state per layout: `tab` already comes
 * from the URL (`useUrlTab`), so switching screens on mobile is the same
 * re-render as switching tabs on desktop, and in-progress edits (e.g. an
 * unsaved capability toggle) survive navigating between them.
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
  loadSeedDiff,
  onResetToDefault,
  mobile,
  onBack,
}: {
  role: RoleSummary;
  users: Map<number, UserListItem>;
  onSaveDetails: (values: DetailsValues) => Promise<void>;
  onSaveCapabilities: (
    capabilities: { capability: string; state: PermissionState }[],
  ) => Promise<void>;
  onAddMember: (userId: number, user?: UserListItem) => Promise<void>;
  onRemoveMember: (userId: number) => Promise<void>;
  onDelete: () => Promise<void>;
  searchUsers: (query: string) => Promise<UserOption[]>;
  /** H8: only meaningful when role.isSeeded — reports drift from role_seed_defaults. */
  loadSeedDiff: () => Promise<RoleSeedDiff>;
  onResetToDefault: () => Promise<void>;
  /** Narrow-viewport drill-down presentation instead of the tabbed master-detail one. */
  mobile?: boolean;
  /** Mobile only: returns to the roles list screen. */
  onBack?: () => void;
}) {
  const { t } = useLocale();
  const { tab, setTab } = useUrlTab({
    values: ["display", "capabilities", "members"] as const,
    defaultValue: "display",
    aliases: { overview: "display", advanced: "display" },
  });

  // H8: is_protected is the real, DB-enforced lockout (assertNotProtectedRole,
  // role-authority.ts) — every control this UI disables mirrors exactly what
  // the server refuses. system:superadmin is the only role that carries this
  // flag today, but the check is generic for any future protected role.
  const isProtected = role.isProtected;

  const schema = detailsSchema(t);
  const form = useForm<DetailsValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: role.name,
      isVisible: role.isVisible,
    },
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

  // H8: seeded roles (0801/0805) can drift from their seed-time snapshot as
  // an admin edits their capabilities; re-check on every role change (and
  // after every capability save/reset, since applyRole gives us a new
  // `role` object) so the "reset to default" banner tracks live drift.
  const [seedDiff, setSeedDiff] = useState<RoleSeedDiff | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadSeedDiff is a fresh closure per render (like searchUsers); depending only on role identity is intentional.
  useEffect(() => {
    let active = true;
    if (!role.isSeeded) {
      setSeedDiff(null);
      return;
    }
    loadSeedDiff()
      .then((d) => {
        if (active) setSeedDiff(d);
      })
      .catch(() => {
        if (active) setSeedDiff(null);
      });
    return () => {
      active = false;
    };
  }, [role]);

  async function confirmReset() {
    setResetting(true);
    try {
      await onResetToDefault();
    } finally {
      setResetting(false);
      setResetOpen(false);
    }
  }

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

  const roleHeader = (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="type-page-title text-balance">{role.name}</h1>
      {isProtected && (
        <StatusBadge tone="neutral" dot={false}>
          <LockIcon className="size-3" /> {t("systemRoleBadge")}
        </StatusBadge>
      )}
    </div>
  );

  const displaySection = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submitDetails)}>
        <SectionCard
          title={t("roleDetailsTitle")}
          description={isProtected ? t("superadminLockedDesc") : undefined}
          footer={
            !isProtected ? (
              <SubmitButton pending={form.formState.isSubmitting}>{t("saveChanges")}</SubmitButton>
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
                  <Input {...field} disabled={isProtected} />
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
                    disabled={isProtected}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </SectionCard>
      </form>
    </Form>
  );

  const dangerZoneSection = (
    <SectionCard
      icon={Trash2Icon}
      title={t("dangerZoneTitle")}
      description={isProtected ? t("superadminLockedDesc") : t("deletingRoleRemovesDesc")}
      action={
        !isProtected ? (
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            {t("deleteRole")}
          </Button>
        ) : undefined
      }
    >
      {!isProtected && (
        <p className="text-muted-foreground text-sm">{t("cannotBeUndoneMembersLoseRole")}</p>
      )}
    </SectionCard>
  );

  const capabilitiesSection = (
    <>
      {seedDiff?.hasDrifted && (
        <SectionCard
          icon={History}
          title={t("roleDriftedFromDefault")}
          action={
            <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
              {t("resetToDefault")}
            </Button>
          }
        >
          {null}
        </SectionCard>
      )}
      {/* No title here — the "Capabilities" tab label / nav row already names this panel (H8). */}
      <SectionCard
        icon={KeyRoundIcon}
        description={isProtected ? t("superadminLockedDesc") : t("capabilitiesChangeDesc")}
        bodyClassName="p-0"
        footer={
          !isProtected ? (
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
                disabled={isProtected}
                onChange={(cap, state) => setCaps((prev) => ({ ...prev, [cap]: state }))}
              />
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );

  const membersSection = (
    <MembersPanel
      role={role}
      users={users}
      disabled={isProtected}
      onAdd={onAddMember}
      onRemove={onRemoveMember}
      search={searchUsers}
    />
  );

  const deleteModal = (
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
  );

  const resetModal = (
    <AlertModal
      open={resetOpen}
      onOpenChange={setResetOpen}
      title={t("resetToDefaultTitle", { name: role.name })}
      description={t("resetToDefaultDescription")}
      cancelLabel={t("cancel")}
      confirmLabel={t("resetToDefault")}
      pending={resetting}
      onConfirm={confirmReset}
    >
      {seedDiff && seedDiff.diff.length > 0 && (
        <ul className="divide-border max-h-64 divide-y overflow-y-auto rounded-md border text-sm">
          {seedDiff.diff.map((entry) => (
            <li
              key={entry.capability}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="truncate font-mono text-xs">{entry.capability}</span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {t(capabilityStateKey(entry.current))} → {t(capabilityStateKey(entry.default))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </AlertModal>
  );

  if (mobile) {
    if (tab === "capabilities") {
      return (
        <div className="space-y-4">
          <DrilldownBackButton label={role.name} onClick={() => setTab("display")} />
          {capabilitiesSection}
          {resetModal}
        </div>
      );
    }
    if (tab === "members") {
      return (
        <div className="space-y-4">
          <DrilldownBackButton label={role.name} onClick={() => setTab("display")} />
          {membersSection}
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <DrilldownBackButton label={t("backToRoles")} onClick={() => onBack?.()} />
        {roleHeader}
        {displaySection}
        <SectionCard bodyClassName="p-0">
          <div className="divide-border divide-y">
            <RoleNavRow label={t("capabilitiesLabel")} onClick={() => setTab("capabilities")} />
            <RoleNavRow label={t("membersTitle")} onClick={() => setTab("members")} />
          </div>
        </SectionCard>
        {dangerZoneSection}
        {deleteModal}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {roleHeader}

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("roleSections")} className="w-full justify-start">
          <TabsTrigger value="display">{t("displayTab")}</TabsTrigger>
          <TabsTrigger value="capabilities">{t("capabilitiesLabel")}</TabsTrigger>
          <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>
        </TabBar>

        <TabsContent value="display" className="space-y-6 pt-2">
          {displaySection}
          {dangerZoneSection}
        </TabsContent>

        <TabsContent value="capabilities" className="space-y-4 pt-2">
          {capabilitiesSection}
        </TabsContent>

        <TabsContent value="members" className="pt-2">
          {membersSection}
        </TabsContent>
      </Tabs>

      {deleteModal}
      {resetModal}
    </div>
  );
}

/**
 * Visually matches `BackLink` (same icon/label/classes) but is wired to an
 * in-page state transition rather than route navigation — the mobile
 * drill-down never changes route, only `?role=`/`tab` state, so `BackLink`'s
 * `router.back()`/`history`-depth logic (built for actual page-to-page nav,
 * see `components/common/back-link.tsx`) doesn't apply here.
 */
export function DrilldownBackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {label}
    </button>
  );
}

/** A plain navigation row (name + chevron) into a mobile drill-down sub-screen. */
function RoleNavRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/50 flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium"
    >
      {label}
      <ChevronRightIcon aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}

function capabilityStateKey(state: PermissionState): MessageKey {
  return state === "allow"
    ? "capabilityStateAllow"
    : state === "deny"
      ? "capabilityStateDeny"
      : "capabilityStateInherit";
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
        {capabilities.map((cap) => {
          const description = capabilityDescription(cap, t);
          return (
            <div
              key={cap}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{prettifyCapability(cap, t)}</p>
                {description && (
                  <p className="text-muted-foreground truncate text-xs">{description}</p>
                )}
                <p className="text-muted-foreground truncate font-mono text-xs">{cap}</p>
              </div>
              <CapabilityStateControl
                state={caps[cap] ?? "inherit"}
                disabled={disabled}
                onChange={(state) => onChange(cap, state)}
              />
            </div>
          );
        })}
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
          {t(capabilityStateKey(candidate))}
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
    // No title here — the "Members" tab label above already names this panel (H8).
    <SectionCard description={disabled ? t("superadminLockedDesc") : undefined} bodyClassName="p-0">
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
