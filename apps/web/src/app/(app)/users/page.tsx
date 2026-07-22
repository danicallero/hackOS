"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { SearchIcon, SlidersHorizontalIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/common/capability-gate";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { logisticsApi } from "@/lib/logistics";
import { useCan } from "@/lib/session";
import type { Tone } from "@/lib/tones";
import type { DerivedRole, UserList, UserListItem } from "@/lib/types";
import { ActiveInvitationsModal } from "./active-invitations-modal";
import { InviteUserDialog } from "./invite-dialog";

function initials(u: UserListItem): string {
  const a = u.name?.trim()?.[0];
  const b = u.surname?.trim()?.[0];
  if (a || b) return `${a ?? ""}${b ?? ""}`.toUpperCase();
  return u.email.slice(0, 2).toUpperCase();
}

function fullName(u: UserListItem): string {
  const name = [u.name, u.surname].filter(Boolean).join(" ").trim();
  return name || "—";
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function roleLabel(t: Translate): Record<DerivedRole, string> {
  return {
    admin: t("roleAdmin"),
    judge: t("roleJudge"),
    sponsor: t("roleSponsor"),
    staff: t("roleStaff"),
    mentor: t("roleMentor"),
    participant: t("roleParticipant"),
    unassigned: t("roleUnassigned"),
  };
}

/** Distinct tone per role so Admin/Judge/Sponsor/Staff never share a color.
 * Kept in sync with the profile header (users/[id]/page.tsx). */
const ROLE_TONE: Record<DerivedRole, Tone> = {
  admin: "brand",
  judge: "info",
  sponsor: "warning",
  staff: "success",
  mentor: "info",
  participant: "neutral",
  unassigned: "neutral",
};

const COLUMN_OPTIONS = [
  "name",
  "role",
  "email",
  "application",
  "badge",
  "presence",
  "phone",
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
    phone: t("phone"),
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
    case "submitted":
      return t("dataStatusSubmitted");
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
  const roleLabels = roleLabel(t);
  return [
    {
      id: "name",
      header: t("name"),
      sortValue: (u) => `${u.surname ?? ""} ${u.name ?? ""}`.trim().toLowerCase(),
      cell: (u) => (
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>{initials(u)}</AvatarFallback>
          </Avatar>
          <span className="font-medium">{fullName(u)}</span>
        </div>
      ),
    },
    {
      id: "role",
      header: t("colRole"),
      sortValue: (u) => u.role,
      cell: (u) => (
        <StatusBadge tone={ROLE_TONE[u.role]} dot={false}>
          {roleLabels[u.role]}
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
      id: "phone",
      header: t("phone"),
      cell: (u) =>
        u.phone ? (
          <span className="text-sm">{u.phone}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
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

export default function UsersPage() {
  const { t } = useLocale();
  const ROLE_LABEL = useMemo(() => roleLabel(t), [t]);
  const COLUMN_LABEL = useMemo(() => columnLabel(t), [t]);
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [emailFilter, setEmailFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [spotFilter, setSpotFilter] = useState("all");
  const [visibleColumns, setVisibleColumns] = useState<Set<UserColumnId>>(DEFAULT_COLUMNS);
  const [columnsHydrated, setColumnsHydrated] = useState(false);
  const canScanPresence = useCan(CAPABILITIES.PRESENCE_SCAN);
  const canStats = useCan(CAPABILITIES.LOGISTICS_STATS);
  const showPresence = canScanPresence || canStats;
  const [presentIds, setPresentIds] = useState<Set<number> | null>(null);

  // Restore the saved column choice on mount (after hydration to avoid a
  // server/client mismatch), then persist any change back to localStorage.
  useEffect(() => {
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
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // Live occupancy for the optional Presence column — only fetched for staff
  // who could otherwise see it via the presence/stats panels anyway.
  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!showPresence) {
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
    setLoading(true);
    setLoadError(null);
    const handle = setTimeout(() => {
      api
        .get<UserList>("/api/users", { query: { q: q.trim() || undefined, limit: 200 } })
        .then((r) => {
          if (cancelled) return;
          setUsers(r.users);
          setTotal(r.total);
        })
        .catch((err) => {
          if (cancelled) return;
          setUsers([]);
          setTotal(0);
          const message = err instanceof ApiError ? err.message : t("couldNotLoadUsers");
          setLoadError(message);
          toast.error(message);
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
        if (emailFilter === "verified" && !user.emailVerified) return false;
        if (emailFilter === "unverified" && user.emailVerified) return false;
        if (roleFilter !== "all" && user.role !== roleFilter) return false;
        if (spotFilter === "confirmed" && user.applicationStatus !== "confirmed") return false;
        if (
          spotFilter === "accepted_pending" &&
          user.applicationStatus !== "accepted" &&
          user.applicationStatus !== "accepted_internal"
        )
          return false;
        if (spotFilter === "declined" && user.applicationStatus !== "declined") return false;
        if (spotFilter === "not_confirmed" && user.applicationStatus === "confirmed") return false;
        return true;
      }),
    [users, emailFilter, roleFilter, spotFilter],
  );
  const hasFilters =
    q.trim().length > 0 || emailFilter !== "all" || roleFilter !== "all" || spotFilter !== "all";

  function clearUserFilters() {
    setQ("");
    setEmailFilter("all");
    setRoleFilter("all");
    setSpotFilter("all");
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("users")}
        state={
          total > 0 ? (
            <StatusBadge tone="neutral" dot={false}>
              {total === 1
                ? t("peopleCountOne", { count: total })
                : t("peopleCountOther", { count: total })}
            </StatusBadge>
          ) : undefined
        }
        description={total > users.length ? t("showingFirst", { shown: users.length }) : undefined}
        actions={
          <CapabilityGate capability={CAPABILITIES.INVITES_MANAGE}>
            <ActiveInvitationsModal />
            <InviteUserDialog />
          </CapabilityGate>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <label htmlFor="user-search" className="sr-only">
            {t("searchUsers")}
          </label>
          <SearchIcon
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            id="user-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("searchUsersPlaceholder")}
            className="h-9 pr-9 pl-9"
          />
          {q && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2"
              onClick={() => {
                setQ("");
                document.getElementById("user-search")?.focus();
              }}
              aria-label={t("clearSearch")}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <span
          role="status"
          aria-live="polite"
          className="text-muted-foreground text-xs tabular-nums"
        >
          {t("tableResultCount", { count: filteredUsers.length })}
        </span>
        <Select value={emailFilter} onValueChange={setEmailFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("anyEmail")}</SelectItem>
            <SelectItem value="verified">{t("verified")}</SelectItem>
            <SelectItem value="unverified">{t("unverified")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("anyRole")}</SelectItem>
            {Object.entries(ROLE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={spotFilter} onValueChange={setSpotFilter}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("anySpot")}</SelectItem>
            <SelectItem value="confirmed">{t("confirmed")}</SelectItem>
            <SelectItem value="accepted_pending">{t("acceptedPending")}</SelectItem>
            <SelectItem value="declined">{t("declined")}</SelectItem>
            <SelectItem value="not_confirmed">{t("notConfirmed")}</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontalIcon />
              {t("columnsLabel")}
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

      <DataTable
        columns={columns}
        data={filteredUsers}
        getRowId={(u) => String(u.id)}
        getRowHref={(u) => `/users/${u.id}`}
        getRowLabel={(u) => `${u.name ?? ""} ${u.surname ?? ""}`.trim() || u.email}
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
          description: t("usersAppearHere"),
        }}
        filteredEmpty={{ active: hasFilters, onClear: clearUserFilters }}
      />
    </div>
  );
}
