"use client";

import {
  BanIcon,
  CopyIcon,
  MailIcon,
  MailPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCwIcon,
  TimerResetIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { ApiError, api } from "@/lib/api";
import { shortDateTimeFmt } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import type {
  EnterpriseInviteLink,
  EnterpriseSummary,
  InviteListItem,
  UserInviteLink,
} from "@/lib/types";
import { UserInviteLinksSection } from "./user-invite-links-section";

const dateFmt = shortDateTimeFmt;

const LINK_STATUS_TONE: Record<
  EnterpriseInviteLink["status"],
  "success" | "warning" | "danger" | "neutral"
> = {
  active: "success",
  expired: "warning",
  exhausted: "warning",
  withdrawn: "danger",
};

export function ActiveInvitationsModal() {
  const { t } = useLocale();
  const copyLink = useCopyToClipboard();
  const kindLabel: Record<string, string> = {
    staff: t("roleStaff"),
    sponsor: t("roleSponsor"),
    participant: t("roleParticipant"),
  };
  const [open, setOpen] = useState(false);
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [enterpriseLinks, setEnterpriseLinks] = useState<EnterpriseInviteLink[]>([]);
  const [userLinks, setUserLinks] = useState<UserInviteLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [withdrawLinkId, setWithdrawLinkId] = useState<number | null>(null);
  const [createLinkOpen, setCreateLinkOpen] = useState(false);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [enterpriseOptionsError, setEnterpriseOptionsError] = useState(false);
  const [createEnterpriseId, setCreateEnterpriseId] = useState("");
  const [maxRedeems, setMaxRedeems] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("10080");
  const [neverExpires, setNeverExpires] = useState(false);
  const [createLinkError, setCreateLinkError] = useState<string | null>(null);
  const [createLinkPending, setCreateLinkPending] = useState(false);
  const [mobileLinkQuery, setMobileLinkQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [inviteData, linkData, userLinkData] = await Promise.all([
        api.get<InviteListItem[]>("/api/invites"),
        api.get<EnterpriseInviteLink[]>("/api/invites/enterprise-links"),
        api.get<UserInviteLink[]>("/api/invites/user-links"),
      ]);
      setInvites(inviteData);
      setEnterpriseLinks(linkData);
      setUserLinks(userLinkData);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadInvitations");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || !createLinkOpen) return;
    api
      .get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options")
      .then((data) => {
        setEnterprises(data.enterprises);
        setEnterpriseOptionsError(false);
      })
      .catch(() => {
        setEnterprises([]);
        setEnterpriseOptionsError(true);
      });
  }, [open, createLinkOpen]);

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

  async function withdrawLink(id: number) {
    const key = `enterprise-link:${id}:withdraw`;
    setBusy((prev) => new Set(prev).add(key));
    try {
      await api.post(`/api/invites/enterprise-links/${id}/withdraw`);
      setWithdrawLinkId(null);
      toast.success(t("linkWithdrawn"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotWithdrawLink"));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function resetCreateLinkForm() {
    setCreateEnterpriseId("");
    setMaxRedeems("");
    setExpiryMinutes("10080");
    setNeverExpires(false);
    setCreateLinkError(null);
  }

  async function createEnterpriseLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateLinkError(null);
    const parsedMax = maxRedeems.trim() ? Number(maxRedeems) : null;
    const parsedExpiry = expiryMinutes.trim() ? Number(expiryMinutes) : NaN;
    if (!createEnterpriseId) {
      setCreateLinkError(t("required"));
      return;
    }
    if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
      setCreateLinkError(t("maxRedeemsDesc"));
      return;
    }
    if (!neverExpires && (!Number.isInteger(parsedExpiry) || parsedExpiry < 1)) {
      setCreateLinkError(t("expiryMinutesDesc"));
      return;
    }

    setCreateLinkPending(true);
    try {
      await api.post<EnterpriseInviteLink>("/api/invites/enterprise-links", {
        enterpriseId: Number(createEnterpriseId),
        maxRedeems: parsedMax,
        expiresInMinutes: neverExpires ? null : parsedExpiry,
      });
      setCreateLinkOpen(false);
      resetCreateLinkForm();
      toast.success(t("linkCreated"));
      await load();
    } catch (err) {
      setCreateLinkError(
        err instanceof ApiError ? err.message : t("couldNotCreateEnterpriseInviteLink"),
      );
    } finally {
      setCreateLinkPending(false);
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
      header: t("created"),
      sortValue: (i) => i.createdAt,
      cell: (i) => (
        <span className="text-muted-foreground text-sm">
          {dateFmt.format(new Date(i.createdAt))}
        </span>
      ),
    },
  ];

  const enterpriseLinkColumns: Column<EnterpriseInviteLink>[] = [
    {
      id: "link",
      header: t("copyInviteLink"),
      sortValue: (link) => link.url,
      cell: (link) => (
        <span className="block max-w-56 truncate font-mono text-xs" title={link.url}>
          {link.url}
        </span>
      ),
    },
    {
      id: "enterprise",
      header: t("colEnterprise"),
      sortValue: (link) => link.enterpriseName.toLowerCase(),
      cell: (link) => <span className="font-medium">{link.enterpriseName}</span>,
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (link) => {
        const label =
          link.status === "active"
            ? t("linkStatusActive")
            : link.status === "expired"
              ? t("linkStatusExpired")
              : link.status === "exhausted"
                ? t("linkStatusExhausted")
                : t("linkStatusWithdrawn");
        return <StatusBadge tone={LINK_STATUS_TONE[link.status]}>{label}</StatusBadge>;
      },
    },
    {
      id: "usage",
      header: t("redemptionsLabel"),
      sortValue: (link) => link.redeemedCount,
      cell: (link) => (
        <span className="text-sm tabular-nums">
          {link.maxRedeems === null
            ? t("redeemedUnlimitedLabel", { used: link.redeemedCount })
            : t("redeemedCountLabel", {
                used: link.redeemedCount,
                maximum: link.maxRedeems,
              })}
        </span>
      ),
    },
    {
      id: "expiresAt",
      header: t("colExpires"),
      sortValue: (link) => link.expiresAt ?? "",
      cell: (link) => (
        <span className="text-muted-foreground text-sm">
          {link.expiresAt ? dateFmt.format(new Date(link.expiresAt)) : t("linkNeverExpires")}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: t("created"),
      sortValue: (link) => link.createdAt,
      cell: (link) => (
        <span className="text-muted-foreground text-sm">
          {dateFmt.format(new Date(link.createdAt))}
        </span>
      ),
    },
  ];

  function linkStatusLabel(link: EnterpriseInviteLink): string {
    return link.status === "active"
      ? t("linkStatusActive")
      : link.status === "expired"
        ? t("linkStatusExpired")
        : link.status === "exhausted"
          ? t("linkStatusExhausted")
          : t("linkStatusWithdrawn");
  }

  function linkUsageLabel(link: EnterpriseInviteLink): string {
    return link.maxRedeems === null
      ? t("redeemedUnlimitedLabel", { used: link.redeemedCount })
      : t("redeemedCountLabel", { used: link.redeemedCount, maximum: link.maxRedeems });
  }

  const filteredMobileLinks = enterpriseLinks.filter((link) => {
    const query = mobileLinkQuery.trim().toLowerCase();
    return (
      !query || `${link.url} ${link.enterpriseName} ${link.status}`.toLowerCase().includes(query)
    );
  });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setInvites([]);
          setEnterpriseLinks([]);
          setUserLinks([]);
          setCreateLinkOpen(false);
          setMobileLinkQuery("");
          resetCreateLinkForm();
        }
      }}
      trigger={
        <Button variant="outline">
          <MailIcon className="size-4" /> {t("invitationManagement")}
        </Button>
      }
      icon={MailIcon}
      title={t("invitationManagement")}
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
                <IconButton variant="ghost" size="icon-sm" label={t("openMenuAria")}>
                  <MoreHorizontalIcon className="size-4" />
                </IconButton>
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
        }}
      />
      <section className="mt-6 space-y-3" aria-labelledby="enterprise-invite-links-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="enterprise-invite-links-heading" className="text-balance font-medium">
              {t("enterpriseInviteLinks")}
            </h3>
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => setCreateLinkOpen((current) => !current)}
          >
            <PlusIcon className="size-4" aria-hidden="true" /> {t("createEnterpriseInviteLink")}
          </Button>
        </div>
        {createLinkOpen && (
          <form
            onSubmit={createEnterpriseLink}
            className="space-y-4 rounded-lg border p-4"
            aria-label={t("createEnterpriseInviteLink")}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="users-invite-link-enterprise">{t("enterpriseLabel")}</Label>
                <EntityCombobox
                  id="users-invite-link-enterprise"
                  inDialog
                  options={enterprises}
                  value={createEnterpriseId}
                  onChange={setCreateEnterpriseId}
                  getId={(enterprise) => enterprise.id}
                  getLabel={(enterprise) => enterprise.name}
                  placeholder={t("selectSponsorEnterprise")}
                  aria-describedby={
                    enterpriseOptionsError ? "users-invite-link-enterprise-error" : undefined
                  }
                />
                {enterpriseOptionsError && (
                  <p
                    id="users-invite-link-enterprise-error"
                    className="text-destructive text-xs"
                    role="alert"
                  >
                    {t("couldNotLoadEnterprises")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="users-invite-link-max-redeems">{t("maxRedeemsLabel")}</Label>
                <Input
                  id="users-invite-link-max-redeems"
                  type="number"
                  name="maxRedeems"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={maxRedeems}
                  onChange={(event) => setMaxRedeems(event.target.value)}
                  placeholder={t("unlimitedRedeems")}
                />
                <p className="text-muted-foreground text-xs">{t("maxRedeemsDesc")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="users-invite-link-expiry">{t("expiryMinutesLabel")}</Label>
                <Input
                  id="users-invite-link-expiry"
                  type="number"
                  name="expiresInMinutes"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={expiryMinutes}
                  onChange={(event) => setExpiryMinutes(event.target.value)}
                  disabled={neverExpires}
                />
                <p className="text-muted-foreground text-xs">{t("expiryMinutesDesc")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="users-invite-link-never-expires"
                checked={neverExpires}
                onCheckedChange={(checked) => setNeverExpires(checked === true)}
              />
              <Label htmlFor="users-invite-link-never-expires" className="leading-5">
                {t("neverExpiresLabel")}
              </Label>
            </div>
            {createLinkError && (
              <p role="alert" className="text-destructive text-sm">
                {createLinkError}
              </p>
            )}
            <div className="grid gap-2 sm:flex sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={createLinkPending}
                onClick={() => {
                  setCreateLinkOpen(false);
                  resetCreateLinkForm();
                }}
              >
                {t("cancel")}
              </Button>
              <SubmitButton pending={createLinkPending} className="w-full sm:w-auto">
                {t("createLink")}
              </SubmitButton>
            </div>
          </form>
        )}
        <div className="sm:hidden">
          {!loadError && !loading && enterpriseLinks.length > 0 && (
            <div className="mb-3">
              <Label htmlFor="mobile-enterprise-invite-link-search" className="sr-only">
                {t("searchEnterpriseInviteLinks")}
              </Label>
              <Input
                id="mobile-enterprise-invite-link-search"
                type="search"
                value={mobileLinkQuery}
                onChange={(event) => setMobileLinkQuery(event.target.value)}
                placeholder={t("searchEnterpriseInviteLinks")}
              />
            </div>
          )}
          {loadError ? (
            <ContextualError message={loadError} onRetry={load} />
          ) : loading ? (
            <p className="text-muted-foreground text-sm">{t("loading")}</p>
          ) : enterpriseLinks.length === 0 ? (
            <EmptyState icon={MailIcon} title={t("noEnterpriseInviteLinks")} />
          ) : filteredMobileLinks.length === 0 ? (
            <EmptyState
              title={t("noFilteredResults")}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMobileLinkQuery("")}
                >
                  {t("clearFilters")}
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredMobileLinks.map((link) => {
                const withdrawKey = `enterprise-link:${link.id}:withdraw`;
                return (
                  <article key={link.id} className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <StatusBadge tone={LINK_STATUS_TONE[link.status]}>
                          {linkStatusLabel(link)}
                        </StatusBadge>
                        <p className="break-all font-mono text-xs" title={link.url}>
                          {link.url}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          type="button"
                          variant="ghost"
                          size="icon-lg"
                          label={t("copyInviteLink")}
                          title={t("copyInviteLink")}
                          onClick={() => void copyLink(link.url)}
                        >
                          <CopyIcon className="size-4" aria-hidden="true" />
                        </IconButton>
                        {link.status === "active" && (
                          <AlertModal
                            trigger={
                              <IconButton
                                type="button"
                                variant="ghost"
                                size="icon-lg"
                                label={t("withdrawLink")}
                                title={t("withdrawLink")}
                              >
                                <BanIcon className="size-4" aria-hidden="true" />
                              </IconButton>
                            }
                            open={withdrawLinkId === link.id}
                            onOpenChange={(nextOpen) =>
                              setWithdrawLinkId(nextOpen ? link.id : null)
                            }
                            title={t("withdrawLinkTitle")}
                            description={t("withdrawLinkDesc")}
                            cancelLabel={t("cancel")}
                            confirmLabel={t("withdrawLink")}
                            destructive
                            pending={busy.has(withdrawKey)}
                            onConfirm={() => void withdrawLink(link.id)}
                          />
                        )}
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">{t("colEnterprise")}</dt>
                        <dd className="truncate font-medium">{link.enterpriseName}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("redemptionsLabel")}</dt>
                        <dd className="tabular-nums">{linkUsageLabel(link)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("colExpires")}</dt>
                        <dd>
                          {link.expiresAt
                            ? dateFmt.format(new Date(link.expiresAt))
                            : t("linkNeverExpires")}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{t("created")}</dt>
                        <dd>{dateFmt.format(new Date(link.createdAt))}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div className="hidden sm:block">
          <DataTable
            columns={enterpriseLinkColumns}
            data={enterpriseLinks}
            getRowId={(link) => String(link.id)}
            searchable={(link) => `${link.url} ${link.enterpriseName} ${link.status}`}
            searchPlaceholder={t("searchEnterpriseInviteLinks")}
            rowActions={(link) => {
              const withdrawKey = `enterprise-link:${link.id}:withdraw`;
              return (
                <div className="flex items-center justify-end gap-1">
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    label={t("copyInviteLink")}
                    title={t("copyInviteLink")}
                    onClick={() => void copyLink(link.url)}
                  >
                    <CopyIcon className="size-4" aria-hidden="true" />
                  </IconButton>
                  {link.status === "active" && (
                    <AlertModal
                      trigger={
                        <Button type="button" variant="ghost" size="sm">
                          {t("withdrawLink")}
                        </Button>
                      }
                      open={withdrawLinkId === link.id}
                      onOpenChange={(nextOpen) => setWithdrawLinkId(nextOpen ? link.id : null)}
                      title={t("withdrawLinkTitle")}
                      description={t("withdrawLinkDesc")}
                      cancelLabel={t("cancel")}
                      confirmLabel={t("withdrawLink")}
                      destructive
                      pending={busy.has(withdrawKey)}
                      onConfirm={() => void withdrawLink(link.id)}
                    />
                  )}
                </div>
              );
            }}
            pageSize={5}
            loading={loading}
            error={loadError ? { message: loadError, onRetry: load } : undefined}
            empty={{
              icon: MailIcon,
              title: t("noEnterpriseInviteLinks"),
            }}
          />
        </div>
      </section>
      <UserInviteLinksSection
        links={userLinks}
        loading={loading}
        error={loadError}
        visible={open}
        onRetry={load}
        onChanged={load}
      />
    </Modal>
  );
}
