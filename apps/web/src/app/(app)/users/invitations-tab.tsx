"use client";

import { BanIcon, CopyIcon, LinkIcon, MailIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { BackLink } from "@/components/common/back-link";
import { type Column, DataTable } from "@/components/common/data-table";
import { IconButton } from "@/components/common/icon-button";
import { PageHeader } from "@/components/common/page-header";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { ApiError, api } from "@/lib/api";
import { shortDateTimeFmt } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import type { EnterpriseInviteLink, InviteListItem, UserInviteLink } from "@/lib/types";
import { InviteUserDialog } from "./invite-dialog";

const dateFmt = shortDateTimeFmt;
type Redemption = {
  email: string;
  name: string | null;
  redeemedAt: string;
  redeemedIp: string | null;
  redeemedUserAgent: string | null;
};
type Record = {
  key: string;
  id: number;
  source: "email" | "user-link" | "enterprise-link";
  label: string;
  url: string | null;
  enterprise: string | null;
  roles: number[];
  max: number | null;
  used: number;
  expires: string | null;
  created: string;
  createdBy: string | null;
  redemptions: Redemption[];
  token: string | null;
};

/** The persistent invitation workspace (#777): one composer, one list, one inspector. */
export function InvitationsScreen() {
  const { t } = useLocale();
  const copy = useCopyToClipboard();
  const [emails, setEmails] = useState<InviteListItem[]>([]);
  const [links, setLinks] = useState<UserInviteLink[]>([]);
  const [enterpriseLinks, setEnterpriseLinks] = useState<EnterpriseInviteLink[]>([]);
  const [selected, setSelected] = useState<Record | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiring, setExpiring] = useState(false);
  const [resending, setResending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextEmails, nextLinks, nextEnterpriseLinks] = await Promise.all([
        api.get<InviteListItem[]>("/api/invites"),
        api.get<UserInviteLink[]>("/api/invites/user-links"),
        api.get<EnterpriseInviteLink[]>("/api/invites/enterprise-links"),
      ]);
      setEmails(nextEmails);
      setLinks(nextLinks);
      setEnterpriseLinks(nextEnterpriseLinks);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t("couldNotLoadInvitations"));
    } finally {
      setLoading(false);
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  const rows = useMemo<Record[]>(
    () =>
      [
        ...emails.map((item) => ({
          key: `email:${item.id}`,
          id: item.id,
          source: "email" as const,
          label: item.email,
          url: null,
          enterprise: item.enterpriseId ? `#${item.enterpriseId}` : null,
          roles: item.roleIds,
          max: 1,
          used: 0,
          expires: item.expiresAt,
          created: item.createdAt,
          createdBy: null,
          redemptions: [],
          token: item.token,
        })),
        ...links.map((item) => ({
          key: `user-link:${item.id}`,
          id: item.id,
          source: "user-link" as const,
          label: item.url,
          url: item.url,
          enterprise: item.enterpriseName,
          roles: item.roleIds,
          max: item.maxRedeems,
          used: item.redeemedCount,
          expires: item.expiresAt,
          created: item.createdAt,
          createdBy: item.createdByName,
          redemptions: item.redemptions,
          token: null,
        })),
        ...enterpriseLinks.map((item) => ({
          key: `enterprise-link:${item.id}`,
          id: item.id,
          source: "enterprise-link" as const,
          label: item.url,
          url: item.url,
          enterprise: item.enterpriseName,
          roles: [],
          max: item.maxRedeems,
          used: item.redeemedCount,
          expires: item.expiresAt,
          created: item.createdAt,
          createdBy: item.createdByName,
          redemptions: item.redemptions,
          token: null,
        })),
      ].sort((a, b) => b.created.localeCompare(a.created)),
    [emails, links, enterpriseLinks],
  );

  const columns: Column<Record>[] = [
    {
      id: "recipient",
      header: t("recipient"),
      cell: (row) =>
        row.source === "email" ? (
          <span className="font-medium">{row.label}</span>
        ) : (
          <StatusBadge tone="neutral">{t("inviteLink")}</StatusBadge>
        ),
    },
    {
      id: "grants",
      header: t("rolesTitle"),
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {row.enterprise ??
            (row.roles.length ? `${row.roles.length} ${t("rolesTitle").toLowerCase()}` : "—")}
        </span>
      ),
    },
    {
      id: "uses",
      header: t("redemptionsLabel"),
      cell: (row) => (
        <span className="tabular-nums text-sm">
          {row.source === "email"
            ? "—"
            : row.max === null
              ? t("redeemedUnlimitedLabel", { used: row.used })
              : t("redeemedCountLabel", { used: row.used, maximum: row.max })}
        </span>
      ),
    },
    {
      id: "expires",
      header: t("colExpires"),
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {row.expires ? dateFmt.format(new Date(row.expires)) : t("linkNeverExpires")}
        </span>
      ),
    },
    {
      id: "created",
      header: t("created"),
      sortValue: (row) => row.created,
      cell: (row) => (
        <span className="text-muted-foreground text-sm">
          {dateFmt.format(new Date(row.created))}
        </span>
      ),
    },
    {
      id: "copy",
      header: <span className="sr-only">{t("copyInviteLink")}</span>,
      align: "right",
      width: "w-12",
      cell: (row) =>
        row.url ? (
          <IconButton
            variant="ghost"
            size="icon-sm"
            label={t("copyInviteLink")}
            onClick={(event) => {
              event.stopPropagation();
              void copy(row.url as string);
            }}
          >
            <CopyIcon className="size-4" aria-hidden="true" />
          </IconButton>
        ) : null,
    },
  ];

  async function expire() {
    if (!selected) return;
    setExpiring(true);
    try {
      if (selected.source === "email") await api.post(`/api/invites/${selected.id}/expire`);
      else if (selected.source === "user-link")
        await api.post(`/api/invites/user-links/${selected.id}/withdraw`);
      else await api.post(`/api/invites/enterprise-links/${selected.id}/withdraw`);
      setSelected(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t("couldNotWithdrawLink"));
    } finally {
      setExpiring(false);
    }
  }

  async function resend() {
    if (selected?.source !== "email") return;
    setResending(true);
    try {
      await api.post(`/api/invites/${selected.id}/resend`);
      toast.success(t("inviteResent"));
    } catch (cause) {
      toast.error(cause instanceof ApiError ? cause.message : t("couldNotInviteAction"));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        context={<BackLink href="/users" label={t("users")} />}
        title={t("invitationManagement")}
        actions={<InviteUserDialog onChanged={load} />}
      />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.key}
        getRowLabel={(row) => row.label}
        onRowClick={setSelected}
        loading={loading}
        error={error ? { message: error, onRetry: load } : undefined}
        searchable={(row) => `${row.label} ${row.enterprise ?? ""}`}
        searchPlaceholder={t("searchByEmailType")}
        empty={{ icon: MailIcon, title: t("noActiveInvitations") }}
      />
      <SidePanelEditor
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        icon={selected?.source === "email" ? MailIcon : LinkIcon}
        title={selected?.source === "email" ? selected.label : t("inviteLink")}
        className="sm:w-[min(40rem,calc(100vw-2rem))]"
        footer={
          selected ? (
            <div className="flex flex-wrap gap-2">
              {selected.source === "email" && selected.token && (
                <Button
                  variant="outline"
                  onClick={() =>
                    void copy(`${window.location.origin}/claim-account?token=${selected.token}`)
                  }
                >
                  <CopyIcon className="size-4" aria-hidden="true" /> {t("copyInviteLink")}
                </Button>
              )}
              {selected.source === "email" && (
                <Button variant="outline" disabled={resending} onClick={() => void resend()}>
                  {t("resendEmail")}
                </Button>
              )}
              <AlertModal
                trigger={
                  <Button variant="destructive">
                    <BanIcon className="size-4" aria-hidden="true" /> {t("expire")}
                  </Button>
                }
                title={t("withdrawLinkTitle")}
                description={t("withdrawLinkDesc")}
                cancelLabel={t("cancel")}
                confirmLabel={t("expire")}
                destructive
                pending={expiring}
                onConfirm={() => void expire()}
              />
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div className="space-y-6">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("colType")}</dt>
                <dd>{selected.source === "email" ? t("email") : t("link")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("rolesTitle")}</dt>
                <dd>
                  {selected.enterprise ??
                    (selected.roles.length
                      ? `${selected.roles.length} ${t("rolesTitle").toLowerCase()}`
                      : "—")}
                </dd>
              </div>
            </dl>
            <section className="space-y-4">
              <h2 className="type-section-title">{t("created")}</h2>
              <ol className="space-y-0 text-sm">
                {selected.expires && (
                  <li className="relative border-l pb-5 pl-5 before:absolute before:-left-1.25 before:top-1 before:size-2 before:rounded-full before:bg-muted-foreground">
                    <p className="font-medium">
                      {new Date(selected.expires) <= new Date()
                        ? t("linkStatusExpired")
                        : t("colExpires")}
                    </p>
                    <time className="text-muted-foreground text-xs">
                      {dateFmt.format(new Date(selected.expires))}
                    </time>
                  </li>
                )}
                {[...selected.redemptions]
                  .sort((a, b) => b.redeemedAt.localeCompare(a.redeemedAt))
                  .map((redemption) => (
                    <li
                      key={`${redemption.email}:${redemption.redeemedAt}`}
                      className="relative border-l pb-5 pl-5 before:absolute before:-left-1.25 before:top-1 before:size-2 before:rounded-full before:bg-muted-foreground"
                    >
                      <p className="font-medium">{redemption.name ?? redemption.email}</p>
                      <p className="text-muted-foreground text-xs">{redemption.email}</p>
                      <time className="text-muted-foreground text-xs">
                        {dateFmt.format(new Date(redemption.redeemedAt))}
                        {redemption.redeemedIp ? ` · ${redemption.redeemedIp}` : ""}
                        {redemption.redeemedUserAgent ? ` · ${redemption.redeemedUserAgent}` : ""}
                      </time>
                    </li>
                  ))}
                <li className="relative pl-5 before:absolute before:-left-1.25 before:top-1 before:size-2 before:rounded-full before:bg-foreground">
                  <p className="font-medium">
                    {selected.createdBy
                      ? `${selected.createdBy} · ${selected.source === "email" ? t("invitationSent") : t("inviteLinkCreated")}`
                      : selected.source === "email"
                        ? t("invitationSent")
                        : t("inviteLinkCreated")}
                  </p>
                  <time className="text-muted-foreground text-xs">
                    {dateFmt.format(new Date(selected.created))}
                  </time>
                </li>
              </ol>
            </section>
          </div>
        )}
      </SidePanelEditor>
    </div>
  );
}
