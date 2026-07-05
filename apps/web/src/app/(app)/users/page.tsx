"use client";

// Users directory (H7/H8/H10): staff browse every user and drill into a
// profile. Search is server-side (GET /api/users?q=) so it covers the whole
// table, not just the first page — the endpoint paginates (limit ≤ 200).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { UsersIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CapabilityGate } from "@/components/common/capability-gate";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ApiError, api } from "@/lib/api";
import type { UserList, UserListItem } from "@/lib/types";
import { ActiveInvitationsModal } from "./active-invitations-modal";
import { InviteUserDialog } from "./invite-dialog";

/** Initials for the avatar fallback, from name/surname or the email. */
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

const columns: Column<UserListItem>[] = [
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
    id: "email",
    header: "Email",
    sortValue: (u) => u.email.toLowerCase(),
    cell: (u) => (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{u.email}</span>
        <StatusBadge tone={u.emailVerified ? "success" : "warning"} dot={false}>
          {u.emailVerified ? "Verified" : "Unverified"}
        </StatusBadge>
      </div>
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

  // Debounced server-side search so `q` matches name/surname/email across the
  // whole table (endpoint uses ILIKE), not just what's already loaded.
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
  }, [q]);

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

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, surname or email…"
        className="h-9 max-w-sm"
      />

      <DataTable
        columns={columns}
        data={users}
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
