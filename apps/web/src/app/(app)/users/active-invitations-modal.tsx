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
import { useLocale } from "@/lib/i18n";
import type { InviteListItem } from "@/lib/types";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ActiveInvitationsModal() {
  const { t } = useLocale();
  const kindLabel: Record<string, string> = {
    staff: t("roleStaff"),
    sponsor: t("roleSponsor"),
    participant: t("roleParticipant"),
  };
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<InviteListItem[]>("/api/invites");
      setInvites(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadInvitations");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

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
      toast.error(err instanceof ApiError ? err.message : t("couldNotInviteAction"));
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
      header: t("email"),
      sortValue: (i) => i.email.toLowerCase(),
      cell: (i) => <span className="font-medium">{i.email}</span>,
    },
    {
      id: "kind",
      header: t("colType"),
      sortValue: (i) => i.kind,
      cell: (i) => <StatusBadge tone="neutral">{kindLabel[i.kind] ?? i.kind}</StatusBadge>,
    },
    {
      id: "enterprise",
      header: t("colEnterprise"),
      cell: (i) =>
        i.enterpriseId ? (
          <span className="text-muted-foreground text-sm">#{i.enterpriseId}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "expiresAt",
      header: t("colExpires"),
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
      header: t("colCreated"),
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
          <MailIcon className="size-4" /> {t("activeInvitations")}
        </Button>
      }
      icon={MailIcon}
      title={t("activeInvitations")}
      description={t("activeInvitationsDesc")}
      size="xl"
    >
      <DataTable
        columns={columns}
        data={invites}
        getRowId={(i) => String(i.id)}
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        searchable={(i) => `${i.email} ${i.kind}`}
        searchPlaceholder={t("searchByEmailType")}
        rowActions={(i) => {
          const isBusy = (action: string) => busy.has(`${i.id}:${action}`);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("openMenuAria")}
                >
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  disabled={isBusy("renew")}
                  onClick={() => doAction(i.id, "renew", t("expiryExtended"))}
                >
                  <TimerResetIcon className="size-4" />
                  {t("renew")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isBusy("resend")}
                  onClick={() => doAction(i.id, "resend", t("inviteResent"))}
                >
                  <MailPlusIcon className="size-4" />
                  {t("resendEmail")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isBusy("regenerate")}
                  onClick={() => doAction(i.id, "regenerate", t("newInviteCreated"))}
                >
                  <RefreshCwIcon className="size-4" />
                  {t("regenerate")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isBusy("expire")}
                  onClick={() => doAction(i.id, "expire", t("inviteExpired"))}
                >
                  <BanIcon className="size-4" />
                  {t("expire")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
        pageSize={10}
        empty={{
          icon: MailIcon,
          title: t("noActiveInvitations"),
          description: t("inviteSomeone"),
        }}
      />
    </Modal>
  );
}
