"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ShieldIcon } from "@phosphor-icons/react/dist/csr/Shield";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { TagIcon } from "@phosphor-icons/react/dist/csr/Tag";
import { TicketIcon } from "@phosphor-icons/react/dist/csr/Ticket";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { type FilterDefinition, FilterMenu } from "@/components/common/filter-menu";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { ApiError, api } from "@/lib/api";
import { shortDateFmt } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import { toast } from "@/lib/toast";
import type { UserList, UserListItem } from "@/lib/types";
import { UsersActions } from "./users-actions";

function fullName(u: UserListItem): string {
  const name = [u.name, u.surname].filter(Boolean).join(" ").trim();
  return name || "—";
}

const dateFmt = shortDateFmt;

/** H8: roles are arbitrary names now, not a fixed category set — show the name as-is. */
function roleLabel(role: UserListItem["visibleRoleName"], t: Translate): string {
  return role ?? t("roleUnassigned");
}

const ROLE_TONE = "neutral";

const COLUMN_OPTIONS = [
  "name",
  "role",
  "email",
  "application",
  "badge",
  "presence",
  "shirt",
  "language",
  "created",
] as const;
type UserColumnId = (typeof COLUMN_OPTIONS)[number];

function columnLabel(t: Translate): Record<UserColumnId, string> {
  return {
    name: t("name"),
    role: t("colRole"),
    email: t("email"),
    application: t("colApplication"),
    badge: t("badge"),
    presence: t("presence"),
    shirt: t("colShirt"),
    language: t("language"),
    created: t("colJoined"),
  };
}

const DEFAULT_COLUMNS = new Set<UserColumnId>([
  "name",
  "role",
  "email",
  "application",
  "badge",
  "created",
]);

/** Persist the visible-column choice so it survives reloads (H-usability). */
const COLUMNS_STORAGE_KEY = "hackos.users.visibleColumns";

function loadStoredColumns(): Set<UserColumnId> {
  if (typeof window === "undefined") return DEFAULT_COLUMNS;
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_COLUMNS;
    const valid = parsed.filter((id): id is UserColumnId =>
      (COLUMN_OPTIONS as readonly string[]).includes(id),
    );
    return valid.length > 0 ? new Set(valid) : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

function applicationLabel(status: string | null, t: Translate): string {
  if (!status) return t("noApplication");
  switch (status) {
    case "draft":
      return t("dataStatusDraft");
    case "review":
      return t("dataStatusReview");
    case "accepted_internal":
      return t("acceptedUnsent");
    case "rejected_internal":
      return t("rejectedUnsent");
    case "accepted":
      return t("dataStatusAccepted");
    case "rejected":
      return t("dataStatusRejected");
    case "confirmed":
      return t("confirmed");
    case "declined":
      return t("declined");
    case "expired":
      return t("dataStatusExpired");
    default:
      return t("dataStatusOther");
  }
}

function applicationTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed") return "success";
  if (status === "accepted" || status === "accepted_internal") return "warning";
  if (status === "rejected" || status === "rejected_internal" || status === "declined")
    return "danger";
  return "neutral";
}

/** Presence needs the live occupancy set, so the column list is built per-render
 * (see `useCan(PRESENCE_SCAN | LOGISTICS_STATS)` in the page component). */
function buildColumns(presentIds: Set<number> | null, t: Translate): Column<UserListItem>[] {
  return [
    {
      id: "name",
      header: t("name"),
      sortValue: (u) => `${u.surname ?? ""} ${u.name ?? ""}`.trim().toLowerCase(),
      cell: (u) => (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{fullName(u)}</span>
          {u.isTestAccount && (
            <StatusBadge tone="warning" dot={false}>
              {t("reviewFixture")}
            </StatusBadge>
          )}
        </div>
      ),
    },
    {
      id: "role",
      header: t("colRole"),
      sortValue: (u) => u.visibleRoleName ?? "",
      cell: (u) => (
        <StatusBadge tone={ROLE_TONE} dot={false}>
          {roleLabel(u.visibleRoleName, t)}
        </StatusBadge>
      ),
    },
    {
      id: "email",
      header: t("email"),
      sortValue: (u) => u.email.toLowerCase(),
      cell: (u) => (
        <div className="flex items-center gap-2">
          <StatusBadge
            tone={u.emailVerified ? "success" : "warning"}
            dot={false}
            className="w-24 shrink-0 justify-center"
          >
            {u.emailVerified ? t("verified") : t("unverified")}
          </StatusBadge>
          <span className="text-muted-foreground">{u.email}</span>
        </div>
      ),
    },
    {
      id: "application",
      header: t("colApplication"),
      sortValue: (u) => u.applicationStatus ?? "",
      cell: (u) => (
        <StatusBadge tone={applicationTone(u.applicationStatus)} dot={false} className="capitalize">
          {applicationLabel(u.applicationStatus, t)}
        </StatusBadge>
      ),
    },
    {
      id: "badge",
      header: t("badge"),
      cell: (u) =>
        u.badgeId ? (
          <span className="font-mono text-xs">{u.badgeId}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "presence",
      header: t("presence"),
      sortValue: (u) => (presentIds?.has(u.id) ? 1 : 0),
      cell: (u) =>
        presentIds == null ? (
          <span className="text-muted-foreground">—</span>
        ) : presentIds.has(u.id) ? (
          <StatusBadge tone="success">{t("present")}</StatusBadge>
        ) : (
          <StatusBadge tone="neutral" dot={false}>
            {t("away")}
          </StatusBadge>
        ),
    },
    {
      id: "shirt",
      header: t("colShirt"),
      cell: (u) =>
        u.shirtSize ? (
          <span className="text-sm">{u.shirtSize}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "language",
      header: t("language"),
      cell: (u) => <span className="text-sm uppercase">{u.language}</span>,
    },
    {
      id: "created",
      header: t("colJoined"),
      align: "right",
      sortValue: (u) => u.createdAt,
      cell: (u) => (
        <span className="text-muted-foreground text-sm">
          {dateFmt.format(new Date(u.createdAt))}
        </span>
      ),
    },
  ];
}

function UserMobileRow({
  user,
  t,
  columns,
  presentIds,
}: {
  user: UserListItem;
  t: Translate;
  columns: Column<UserListItem>[];
  presentIds: Set<number> | null;
}) {
  const name = fullName(user);
  const values: Record<UserColumnId, string> = {
    name,
    role: roleLabel(user.visibleRoleName, t),
    email: user.email,
    application: applicationLabel(user.applicationStatus, t),
    badge: user.badgeId ?? "—",
    presence: presentIds === null ? "—" : t(presentIds.has(user.id) ? "present" : "away"),
    shirt: user.shirtSize ?? "—",
    language: user.language.toUpperCase(),
    created: dateFmt.format(new Date(user.createdAt)),
  };
  return (
    <Link
      href={`/users/${user.id}`}
      className="focus-visible:ring-ring flex min-w-0 items-start px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <span className="min-w-0 flex-1 wrap-break-word font-medium">{name}</span>
          {user.isTestAccount && (
            <StatusBadge tone="warning" dot={false}>
              {t("reviewFixture")}
            </StatusBadge>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-start gap-1.5">
          {columns
            .filter((column) => column.id !== "name")
            .map((column) => (
              <StatusBadge
                key={column.id}
                tone={
                  column.id === "application"
                    ? applicationTone(user.applicationStatus)
                    : column.id === "email" && !user.emailVerified
                      ? "warning"
                      : "neutral"
                }
                dot={false}
                className="max-w-full items-baseline gap-1 wrap-anywhere text-left"
              >
                <span className="text-muted-foreground shrink-0">{column.header}:</span>
                <span className="min-w-0">{values[column.id as UserColumnId]}</span>
                {column.id === "email" && (
                  <span className="sr-only">
                    {user.emailVerified ? t("verified") : t("unverified")}
                  </span>
                )}
              </StatusBadge>
            ))}
        </div>
      </div>
      <CaretRightIcon className="text-muted-foreground mt-1 size-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}

export default function UsersPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const COLUMN_LABEL = useMemo(() => columnLabel(t), [t]);
  const [q, setQ] = usePersistedState("users-list:q", "");
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const hasLoadedUsers = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [emailSelection, setEmailFilter] = usePersistedState<string | string[]>(
    "users-list:email",
    [],
  );
  const emailFilter = Array.isArray(emailSelection)
    ? emailSelection
    : emailSelection === "all"
      ? []
      : [emailSelection];
  const [roleSelection, setRoleFilter] = usePersistedState<string | string[]>(
    "users-list:role",
    [],
  );
  const roleFilter = Array.isArray(roleSelection)
    ? roleSelection
    : roleSelection === "all"
      ? []
      : [roleSelection];
  const [spotSelection, setSpotFilter] = usePersistedState<string | string[]>(
    "users-list:spot",
    [],
  );
  const spotFilter = Array.isArray(spotSelection)
    ? spotSelection
    : spotSelection === "all"
      ? []
      : [spotSelection];
  const [visibleColumns, setVisibleColumns] = useState<Set<UserColumnId>>(DEFAULT_COLUMNS);
  const [columnsHydrated, setColumnsHydrated] = useState(false);
  const canScanPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const showPresence = canScanPresence || canStats;
  const [presentIds, setPresentIds] = useState<Set<number> | null>(null);

  // Restore the saved column choice on mount (after hydration to avoid a
  // server/client mismatch — a lazy useState initializer would read
  // localStorage during the client's first render, which is the render
  // hydration diffs against the server-rendered DEFAULT_COLUMNS markup),
  // then persist any change back to localStorage.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleColumns(loadStoredColumns());
    setColumnsHydrated(true);
  }, []);

  useEffect(() => {
    if (!columnsHydrated) return;
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...visibleColumns]));
    } catch {
      // Storage unavailable (private mode, quota) — non-fatal.
    }
  }, [visibleColumns, columnsHydrated]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a user elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=identity", [EVENTS.DOMAIN_CHANGED]);

  // Live occupancy for the optional Presence column — only fetched for staff
  // who could otherwise see it via the presence/stats panels anyway.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!showPresence) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresentIds(null);
      return;
    }
    let cancelled = false;
    logisticsApi
      .presenceEstimate()
      .then((r) => {
        if (!cancelled) setPresentIds(new Set(r.present));
      })
      .catch(() => {
        if (!cancelled) setPresentIds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showPresence, liveRefresh]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    let cancelled = false;
    // Preserve populated rows during a live refresh. The initial load and an
    // explicit retry still use the skeleton, but identity SSE must not make
    // the roster disappear between two authoritative reads (#732).
    if (!hasLoadedUsers.current) setLoading(true);
    setLoadError(null);
    const handle = setTimeout(() => {
      api
        .get<UserList>("/api/users", { query: { q: q.trim() || undefined, limit: 200 } })
        .then((r) => {
          if (cancelled) return;
          hasLoadedUsers.current = true;
          setUsers(r.users);
          setTotal(r.total);
        })
        .catch((err) => {
          if (cancelled) return;
          setUsers([]);
          setTotal(0);
          const message = err instanceof ApiError ? err.message : t("couldNotLoadUsers");
          setLoadError(message);
          toast.error(message, t("columnPeople"));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, liveRefresh, retryNonce, t]);

  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        if (emailFilter.length + roleFilter.length + spotFilter.length === 0) return true;
        return (
          emailFilter.includes(user.emailVerified ? "verified" : "unverified") ||
          roleFilter.includes(user.visibleRoleName ?? "") ||
          spotFilter.some((filter) => {
            if (filter === "accepted_pending")
              return ["accepted", "accepted_internal"].includes(user.applicationStatus ?? "");
            if (filter === "not_confirmed") return user.applicationStatus !== "confirmed";
            return user.applicationStatus === filter;
          })
        );
      }),
    [users, emailFilter, roleFilter, spotFilter],
  );
  const hasFilters =
    q.trim().length > 0 || emailFilter.length > 0 || roleFilter.length > 0 || spotFilter.length > 0;

  /** H8: role names are arbitrary now — the filter's option list is whatever
   * distinct role names are actually present in the loaded page of users. */
  const roleFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const u of users) if (u.visibleRoleName) names.add(u.visibleRoleName);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [users]);

  function clearUserFilters() {
    setQ("");
    setEmailFilter([]);
    setRoleFilter([]);
    setSpotFilter([]);
    document.getElementById("user-search")?.focus();
  }

  const availableColumnOptions = useMemo(
    () => COLUMN_OPTIONS.filter((id) => id !== "presence" || showPresence),
    [showPresence],
  );

  const columns = useMemo(
    () =>
      buildColumns(presentIds, t).filter(
        (column) =>
          visibleColumns.has(column.id as UserColumnId) &&
          (column.id !== "presence" || showPresence),
      ),
    [visibleColumns, presentIds, showPresence, t],
  );

  function toggleColumn(id: UserColumnId, checked: boolean) {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else if (next.size > 1) next.delete(id);
      return next;
    });
  }

  const filters: FilterDefinition[] = [
    {
      id: "email",
      label: t("email"),
      icon: EnvelopeSimpleIcon,
      type: "multiple",
      value: emailFilter,
      onChange: (values) => setEmailFilter([...values]),
      options: [
        { value: "verified", label: t("verified") },
        { value: "unverified", label: t("unverified") },
      ],
    },
    {
      id: "role",
      label: t("colRole"),
      icon: ShieldIcon,
      type: "multiple",
      value: roleFilter,
      onChange: (values) => setRoleFilter([...values]),
      options: [...roleFilterOptions.map((name) => ({ value: name, label: name }))],
    },
    {
      id: "spot",
      label: t("colApplication"),
      icon: TicketIcon,
      type: "multiple",
      value: spotFilter,
      onChange: (values) => setSpotFilter([...values]),
      options: [
        { value: "confirmed", label: t("confirmed") },
        { value: "accepted_pending", label: t("acceptedPending") },
        { value: "declined", label: t("declined") },
        { value: "not_confirmed", label: t("notConfirmed") },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        className="flex-row items-center justify-between gap-2 md:items-center"
        title={t("users")}
        state={
          total > 0 ? (
            <span className="text-muted-foreground text-xs tabular-nums">
              {total === 1
                ? t("peopleCountOne", { count: total })
                : t("peopleCountOther", { count: total })}
            </span>
          ) : undefined
        }
        description={total > users.length ? t("showingFirst", { shown: users.length }) : undefined}
        actions={<UsersActions users={filteredUsers} />}
      />

      <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
          <div className="relative min-w-0">
            <label htmlFor="user-search" className="sr-only">
              {t("searchUsers")}
            </label>
            <MagnifyingGlassIcon
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="user-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchUsers")}
              className="pr-9 pl-9"
            />
            {q && (
              <div className="absolute inset-y-0 right-0.5 z-10 flex items-center">
                <IconButton
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    setQ("");
                    document.getElementById("user-search")?.focus();
                  }}
                  label={t("clearSearch")}
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
            )}
          </div>
          <FilterMenu
            iconOnly={isMobile}
            className="contents"
            chipsClassName="col-span-full row-start-2 flex flex-nowrap gap-2 overflow-x-auto overscroll-x-contain pb-1"
            filters={filters}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size={isMobile ? "icon" : "default"}
                aria-label={t(isMobile ? "tagsLabel" : "columnsLabel")}
              >
                {isMobile ? <TagIcon aria-hidden="true" /> : <TableIcon aria-hidden="true" />}
                {!isMobile && t("columnsLabel")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{t("visibleFields")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableColumnOptions.map((id) => (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={visibleColumns.has(id)}
                  onCheckedChange={(checked) => toggleColumn(id, checked === true)}
                  disabled={visibleColumns.size === 1 && visibleColumns.has(id)}
                >
                  {COLUMN_LABEL[id]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasFilters && (
          <span
            role="status"
            aria-live="polite"
            className="text-muted-foreground block text-xs tabular-nums"
          >
            {t("tableResultCount", { count: filteredUsers.length })}
          </span>
        )}

        <DataTable
          columns={columns}
          data={filteredUsers}
          getRowId={(u) => String(u.id)}
          stateKey="users-list"
          getRowHref={(u) => `/users/${u.id}`}
          getRowLabel={(u) => `${u.name ?? ""} ${u.surname ?? ""}`.trim() || u.email}
          renderMobileRow={(u) => (
            <UserMobileRow user={u} t={t} columns={columns} presentIds={presentIds} />
          )}
          pageSize={15}
          loading={loading}
          error={
            loadError
              ? { message: loadError, onRetry: () => setRetryNonce((value) => value + 1) }
              : undefined
          }
          empty={{
            icon: UsersIcon,
            title: t("noUsersYet"),
          }}
          filteredEmpty={{ active: hasFilters, onClear: clearUserFilters }}
        />
      </div>
    </div>
  );
}
