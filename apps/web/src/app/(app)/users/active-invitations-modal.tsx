"use client";

import {
  BanIcon,
  MailIcon,
  MailPlusIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  TimerResetIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, api } from "@/lib/api";
import type { InviteListItem } from "@/lib/types";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const kindLabel: Record<string, string> = {
  staff: "Staff",
  sponsor: "Sponsor",
  participant: "Participant",
};

export function ActiveInvitationsModal() {
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<InviteListItem[]>("/api/invites");
      setInvites(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load invitations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function doAction(id: number, action: string, successMsg: string) {
    const key = `${id}:${action}`;
    setBusy((prev) => new Set(prev).add(key));
    try {
      await api.post(`/api/invites/${id}/${action}`);
      toast.success(successMsg);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not ${action} invite.`);
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const columns: Column<InviteListItem>[] = [
    {
      id: "email",
      header: "Email",
      sortValue: (i) => i.email.toLowerCase(),
      cell: (i) => <span className="font-medium">{i.email}</span>,
    },
    {
      id: "kind",
      header: "Type",
      sortValue: (i) => i.kind,
      cell: (i) => <StatusBadge tone="neutral">{kindLabel[i.kind] ?? i.kind}</StatusBadge>,
    },
    {
      id: "enterprise",
      header: "Enterprise",
      cell: (i) =>
        i.enterpriseId ? (
          <span className="text-muted-foreground text-sm">#{i.enterpriseId}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "expiresAt",
      header: "Expires",
      sortValue: (i) => i.expiresAt,
      cell: (i) => (
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {dateFmt.format(new Date(i.expiresAt))}
          </span>
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "Created",
      sortValue: (i) => i.createdAt,
      cell: (i) => (
        <span className="text-muted-foreground text-sm">
          {dateFmt.format(new Date(i.createdAt))}
        </span>
      ),
    },
  ];

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setInvites([]);
      }}
      trigger={
        <Button variant="outline">
          <MailIcon className="size-4" /> Active invitations
        </Button>
      }
      icon={MailIcon}
      title="Active invitations"
      description="Pending invites that haven't been accepted yet. Renew to extend the window, resend the email, regenerate for a brand-new link, or expire to invalidate immediately."
      size="xl"
    >
      <DataTable
        columns={columns}
        data={invites}
        getRowId={(i) => String(i.id)}
        searchable={(i) => `${i.email} ${i.kind}`}
        searchPlaceholder="Search by email or type…"
        rowActions={(i) => {
          const isBusy = (action: string) => busy.has(`${i.id}:${action}`);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={isBusy("renew")}
                  onClick={() => doAction(i.id, "renew", "Expiry window extended.")}
                >
                  <TimerResetIcon className="size-4" />
                  Renew
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isBusy("resend")}
                  onClick={() => doAction(i.id, "resend", "Invite email re-sent.")}
                >
                  <MailPlusIcon className="size-4" />
                  Resend email
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isBusy("regenerate")}
                  onClick={() =>
                    doAction(i.id, "regenerate", "New invite link created and emailed.")
                  }
                >
                  <RefreshCwIcon className="size-4" />
                  Regenerate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isBusy("expire")}
                  onClick={() => doAction(i.id, "expire", "Invite expired.")}
                >
                  <BanIcon className="size-4" />
                  Expire
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
        pageSize={10}
        loading={loading}
        empty={{
          icon: MailIcon,
          title: "No active invitations",
          description: "Invite someone to get started.",
        }}
      />
    </Modal>
  );
}
