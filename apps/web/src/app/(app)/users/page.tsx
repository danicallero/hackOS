"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { SlidersHorizontalIcon, UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
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

const ROLE_LABEL: Record<DerivedRole, string> = {
  admin: "Admin",
  judge: "Judge",
  sponsor: "Sponsor",
  staff: "Staff",
  participant: "Participant",
};

/** Distinct tone per role so Admin/Judge/Sponsor/Staff never share a color.
 * Kept in sync with the profile header (users/[id]/page.tsx). */
const ROLE_TONE: Record<DerivedRole, Tone> = {
  admin: "brand",
  judge: "info",
  sponsor: "warning",
  staff: "success",
  participant: "neutral",
};

const COLUMN_OPTIONS = [
  "name",
  "role",
  "email",
  "application",
  "badge",
  "phone",
  "shirt",
  "language",
  "created",
] as const;
type UserColumnId = (typeof COLUMN_OPTIONS)[number];

const COLUMN_LABEL: Record<UserColumnId, string> = {
  name: "Name",
  role: "Role",
  email: "Email",
  application: "Application",
  badge: "Badge",
  phone: "Phone",
  shirt: "Shirt",
  language: "Language",
  created: "Joined",
};

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

function applicationLabel(status: string | null): string {
  if (!status) return "No application";
  if (status === "accepted_internal") return "Accepted (unsent)";
  if (status === "rejected_internal") return "Rejected (unsent)";
  return status.replace(/_/g, " ");
}

function applicationTone(status: string | null): "success" | "warning" | "danger" | "neutral" {
  if (status === "confirmed") return "success";
  if (status === "accepted" || status === "accepted_internal") return "warning";
  if (status === "rejected" || status === "rejected_internal" || status === "declined")
    return "danger";
  return "neutral";
}

const allColumns: Column<UserListItem>[] = [
  {
    id: "name",
    header: "Name",
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
    header: "Role",
    sortValue: (u) => u.role,
    cell: (u) => (
      <StatusBadge tone={ROLE_TONE[u.role]} dot={false}>
        {ROLE_LABEL[u.role]}
      </StatusBadge>
    ),
  },
  {
    id: "email",
    header: "Email",
    sortValue: (u) => u.email.toLowerCase(),
    cell: (u) => (
      <div className="flex items-center gap-2">
        <StatusBadge
          tone={u.emailVerified ? "success" : "warning"}
          dot={false}
          className="w-24 shrink-0 justify-center"
        >
          {u.emailVerified ? "Verified" : "Unverified"}
        </StatusBadge>
        <span className="text-muted-foreground">{u.email}</span>
      </div>
    ),
  },
  {
    id: "application",
    header: "Application",
    sortValue: (u) => u.applicationStatus ?? "",
    cell: (u) => (
      <StatusBadge tone={applicationTone(u.applicationStatus)} dot={false} className="capitalize">
        {applicationLabel(u.applicationStatus)}
      </StatusBadge>
    ),
  },
  {
    id: "badge",
    header: "Badge",
    cell: (u) =>
      u.badgeId ? (
        <span className="font-mono text-xs">{u.badgeId}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "phone",
    header: "Phone",
    cell: (u) =>
      u.phone ? (
        <span className="text-sm">{u.phone}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "shirt",
    header: "Shirt",
    cell: (u) =>
      u.shirtSize ? (
        <span className="text-sm">{u.shirtSize}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "language",
    header: "Language",
    cell: (u) => <span className="text-sm uppercase">{u.language}</span>,
  },
  {
    id: "created",
    header: "Joined",
    align: "right",
    sortValue: (u) => u.createdAt,
    cell: (u) => (
      <span className="text-muted-foreground text-sm">{dateFmt.format(new Date(u.createdAt))}</span>
    ),
  },
];

export default function UsersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [emailFilter, setEmailFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [spotFilter, setSpotFilter] = useState("all");
  const [visibleColumns, setVisibleColumns] = useState<Set<UserColumnId>>(DEFAULT_COLUMNS);
  const [columnsHydrated, setColumnsHydrated] = useState(false);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
          toast.error(err instanceof ApiError ? err.message : "Could not load users.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [q, liveRefresh]);

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

  const columns = useMemo(
    () => allColumns.filter((column) => visibleColumns.has(column.id as UserColumnId)),
    [visibleColumns],
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
        title="Users"
        description={
          total > 0
            ? `${total} ${total === 1 ? "person" : "people"}${
                total > users.length ? ` — showing first ${users.length}, refine your search` : ""
              }`
            : "Browse everyone registered in hackOS."
        }
        actions={
          <CapabilityGate capability={CAPABILITIES.INVITES_MANAGE}>
            <ActiveInvitationsModal />
            <InviteUserDialog />
          </CapabilityGate>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, surname or email…"
          className="h-9 max-w-sm"
        />
        <Select value={emailFilter} onValueChange={setEmailFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any email</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="unverified">Unverified</SelectItem>
          </SelectContent>
        </Select>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any role</SelectItem>
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
            <SelectItem value="all">Any spot</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="accepted_pending">Accepted pending</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="not_confirmed">Not confirmed</SelectItem>
          </SelectContent>
        </Select>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9">
              <SlidersHorizontalIcon />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible fields</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {COLUMN_OPTIONS.map((id) => (
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
        onRowClick={(u) => router.push(`/users/${u.id}`)}
        pageSize={15}
        loading={loading}
        empty={{
          icon: UsersIcon,
          title: q.trim() ? "No matching users" : "No users yet",
          description: q.trim()
            ? "Try a different name or email."
            : "Users appear here once they register.",
        }}
      />
    </div>
  );
}
