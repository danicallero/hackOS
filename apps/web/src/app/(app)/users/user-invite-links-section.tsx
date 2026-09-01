"use client";

import { BanIcon, CopyIcon, LinkIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { ContextualError } from "@/components/common/contextual-error";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { MultiSelect } from "@/components/common/multi-select";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { shortDateTimeFmt } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import type { EnterpriseSummary, InviteKind, RoleSummary, UserInviteLink } from "@/lib/types";

const dateFmt = shortDateTimeFmt;

const LINK_STATUS_TONE: Record<
  UserInviteLink["status"],
  "success" | "warning" | "danger" | "neutral"
> = {
  active: "success",
  expired: "warning",
  exhausted: "warning",
  withdrawn: "danger",
};

interface UserInviteLinksSectionProps {
  links: UserInviteLink[];
  loading: boolean;
  error: string | null;
  visible: boolean;
  onRetry: () => Promise<void>;
  onChanged: () => Promise<void>;
}

export function UserInviteLinksSection({
  links,
  loading,
  error,
  visible,
  onRetry,
  onChanged,
}: UserInviteLinksSectionProps) {
  const { t } = useLocale();
  const [createOpen, setCreateOpen] = useState(false);
  const [enterpriseId, setEnterpriseId] = useState("");
  const [allowClosedForms, setAllowClosedForms] = useState(false);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [groups, setGroups] = useState<RoleSummary[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [maxRedeems, setMaxRedeems] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("10080");
  const [neverExpires, setNeverExpires] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [mobileQuery, setMobileQuery] = useState("");
  const [withdrawLinkId, setWithdrawLinkId] = useState<number | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const resetForm = useCallback(() => {
    setEnterpriseId("");
    setAllowClosedForms(false);
    setRoleIds([]);
    setMaxRedeems("");
    setExpiryMinutes("10080");
    setNeverExpires(false);
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (!visible) {
      // The parent modal owns the visibility; clear an unfinished form before
      // the next opening so a copied link is never mistaken for a new draft.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCreateOpen(false);
      setMobileQuery("");
      resetForm();
    }
  }, [resetForm, visible]);

  useEffect(() => {
    if (!visible || !createOpen) return;
    Promise.all([
      api.get<{ enterprises: EnterpriseSummary[] }>("/api/invites/enterprise-options"),
      api.get<RoleSummary[]>("/api/roles"),
    ])
      .then(([enterpriseData, permissionGroups]) => {
        setEnterprises(enterpriseData.enterprises);
        // A protected role (system:superadmin today, CLI-only, H8) is never
        // offerable as a pre-assignable role even though the list endpoint
        // returns it — assigning it would 403 server-side anyway.
        setGroups(permissionGroups.filter((r) => !r.isProtected));
        setOptionsError(false);
      })
      .catch(() => {
        setEnterprises([]);
        setGroups([]);
        setOptionsError(true);
      });
  }, [visible, createOpen]);

  function linkStatusLabel(link: UserInviteLink): string {
    return link.status === "active"
      ? t("linkStatusActive")
      : link.status === "expired"
        ? t("linkStatusExpired")
        : link.status === "exhausted"
          ? t("linkStatusExhausted")
          : t("linkStatusWithdrawn");
  }

  function kindLabel(linkKind: InviteKind): string {
    return linkKind === "staff"
      ? t("roleStaff")
      : linkKind === "sponsor"
        ? t("roleSponsor")
        : t("roleParticipant");
  }

  function usageLabel(link: UserInviteLink): string {
    return link.maxRedeems === null
      ? t("redeemedUnlimitedLabel", { used: link.redeemedCount })
      : t("redeemedCountLabel", {
          used: link.redeemedCount,
          maximum: link.maxRedeems,
        });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("couldNotCopyLink"));
    }
  }

  async function withdrawLink(link: UserInviteLink) {
    const key = `${link.id}:withdraw`;
    setBusy((current) => new Set(current).add(key));
    try {
      await api.post(`/api/invites/user-links/${link.id}/withdraw`);
      setWithdrawLinkId(null);
      toast.success(t("linkWithdrawn"));
      await onChanged();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotWithdrawLink"));
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function createLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    const parsedMax = maxRedeems.trim() ? Number(maxRedeems) : null;
    const parsedExpiry = expiryMinutes.trim() ? Number(expiryMinutes) : NaN;
    // Same derivation as the single-email invite dialog (H8/H9/H10): an
    // enterprise makes it a sponsor link, the closed-form bypass makes it a
    // participant link, otherwise it's a bare staff link — which still needs
    // at least one role server-side, since that's the only thing it's for.
    const kind: InviteKind = enterpriseId ? "sponsor" : allowClosedForms ? "participant" : "staff";
    if (kind === "staff" && roleIds.length === 0) {
      setCreateError(t("staffLinkGroupsRequired"));
      return;
    }
    if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
      setCreateError(t("maxRedeemsDesc"));
      return;
    }
    if (!neverExpires && (!Number.isInteger(parsedExpiry) || parsedExpiry < 1)) {
      setCreateError(t("expiryMinutesDesc"));
      return;
    }

    setCreatePending(true);
    try {
      await api.post<UserInviteLink>("/api/invites/user-links", {
        kind,
        ...(kind === "sponsor" ? { enterpriseId: Number(enterpriseId) } : {}),
        roleIds: roleIds.map(Number),
        maxRedeems: parsedMax,
        expiresInMinutes: neverExpires ? null : parsedExpiry,
      });
      setCreateOpen(false);
      resetForm();
      toast.success(t("userInviteLinkCreated"));
      await onChanged();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t("couldNotCreateUserInviteLink"));
    } finally {
      setCreatePending(false);
    }
  }

  const columns: Column<UserInviteLink>[] = [
    {
      id: "link",
      header: t("copyInviteLink"),
      sortValue: (link) => link.url,
      cell: (link) => (
        <span className="block max-w-52 truncate font-mono text-xs" title={link.url}>
          {link.url}
        </span>
      ),
    },
    {
      id: "kind",
      header: t("colType"),
      sortValue: (link) => link.kind,
      cell: (link) => <StatusBadge tone="neutral">{kindLabel(link.kind)}</StatusBadge>,
    },
    {
      id: "enterprise",
      header: t("colEnterprise"),
      sortValue: (link) => link.enterpriseName ?? "",
      cell: (link) => link.enterpriseName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: "groups",
      header: t("rolesTitle"),
      sortValue: (link) => link.roleIds.length,
      cell: (link) =>
        link.roleIds.length > 0 ? (
          <span className="tabular-nums">{link.roleIds.length}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: t("statusColumn"),
      cell: (link) => (
        <StatusBadge tone={LINK_STATUS_TONE[link.status]}>{linkStatusLabel(link)}</StatusBadge>
      ),
    },
    {
      id: "usage",
      header: t("redemptionsLabel"),
      sortValue: (link) => link.redeemedCount,
      cell: (link) => <span className="text-sm tabular-nums">{usageLabel(link)}</span>,
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
  ];

  const filteredMobileLinks = links.filter((link) => {
    const query = mobileQuery.trim().toLowerCase();
    return (
      !query ||
      `${link.url} ${link.kind} ${link.enterpriseName ?? ""} ${link.status}`
        .toLowerCase()
        .includes(query)
    );
  });

  return (
    <section className="mt-6 space-y-3" aria-labelledby="user-invite-links-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id="user-invite-links-heading" className="text-balance font-medium">
          {t("userInviteLinksTitle")}
        </h3>
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => setCreateOpen((current) => !current)}
        >
          <PlusIcon className="size-4" aria-hidden="true" /> {t("createUserInviteLink")}
        </Button>
      </div>
      {createOpen && (
        <form
          onSubmit={createLink}
          className="space-y-4 rounded-lg border p-4"
          aria-label={t("createUserInviteLink")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="users-user-link-groups">{t("rolesTitle")}</Label>
              <MultiSelect
                inDialog
                id="users-user-link-groups"
                options={groups.map((group) => ({ value: String(group.id), label: group.name }))}
                value={roleIds}
                onChange={setRoleIds}
                placeholder={t("selectStaffGroups")}
                searchPlaceholder={t("searchRolesPlaceholder")}
                emptyText={t("noRolesYet")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="users-user-link-enterprise">{t("enterpriseLabel")}</Label>
              <EntityCombobox
                id="users-user-link-enterprise"
                inDialog
                options={enterprises}
                value={enterpriseId}
                onChange={(value) => {
                  setEnterpriseId(value);
                  // Mutually exclusive kinds on the backend (H9/H10) — an
                  // enterprise makes this a sponsor link.
                  if (value) setAllowClosedForms(false);
                }}
                getId={(enterprise) => enterprise.id}
                getLabel={(enterprise) => enterprise.name}
                placeholder={t("selectSponsorEnterprise")}
                aria-describedby={optionsError ? "users-user-link-options-error" : undefined}
              />
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="users-user-link-allow-closed-forms"
              checked={allowClosedForms}
              disabled={Boolean(enterpriseId)}
              onCheckedChange={(checked) => setAllowClosedForms(checked === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="users-user-link-allow-closed-forms" className="leading-5">
                {t("allowClosedFormsLabel")}
              </Label>
              <p className="text-muted-foreground text-xs">{t("allowClosedFormsHint")}</p>
            </div>
          </div>
          {optionsError && (
            <p id="users-user-link-options-error" className="text-destructive text-sm" role="alert">
              {t("couldNotLoadInviteLinkOptions")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="users-user-link-max-redeems">{t("maxRedeemsLabel")}</Label>
              <Input
                id="users-user-link-max-redeems"
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
              <Label htmlFor="users-user-link-expiry">{t("expiryMinutesLabel")}</Label>
              <Input
                id="users-user-link-expiry"
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
              id="users-user-link-never-expires"
              checked={neverExpires}
              onCheckedChange={(checked) => setNeverExpires(checked === true)}
            />
            <Label htmlFor="users-user-link-never-expires" className="leading-5">
              {t("neverExpiresLabel")}
            </Label>
          </div>
          {createError && (
            <p role="alert" className="text-destructive text-sm">
              {createError}
            </p>
          )}
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={createPending}
              onClick={() => {
                setCreateOpen(false);
                resetForm();
              }}
            >
              {t("cancel")}
            </Button>
            <SubmitButton pending={createPending} className="w-full sm:w-auto">
              {t("createLink")}
            </SubmitButton>
          </div>
        </form>
      )}
      <div className="sm:hidden">
        {!error && !loading && links.length > 0 && (
          <div className="mb-3">
            <Label htmlFor="mobile-user-invite-link-search" className="sr-only">
              {t("searchUserInviteLinks")}
            </Label>
            <Input
              id="mobile-user-invite-link-search"
              type="search"
              value={mobileQuery}
              onChange={(event) => setMobileQuery(event.target.value)}
              placeholder={t("searchUserInviteLinks")}
            />
          </div>
        )}
        {error ? (
          <ContextualError message={error} onRetry={onRetry} />
        ) : loading ? (
          <p className="text-muted-foreground text-sm">{t("loading")}</p>
        ) : links.length === 0 ? (
          <EmptyState icon={LinkIcon} title={t("noUserInviteLinks")} />
        ) : filteredMobileLinks.length === 0 ? (
          <EmptyState
            title={t("noFilteredResults")}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setMobileQuery("")}>
                {t("clearFilters")}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {filteredMobileLinks.map((link) => {
              const withdrawKey = `${link.id}:withdraw`;
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10"
                        aria-label={t("copyInviteLink")}
                        title={t("copyInviteLink")}
                        onClick={() => void copyLink(link.url)}
                      >
                        <CopyIcon className="size-4" aria-hidden="true" />
                      </Button>
                      {link.status === "active" && (
                        <AlertModal
                          trigger={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-10"
                              aria-label={t("withdrawLink")}
                              title={t("withdrawLink")}
                            >
                              <BanIcon className="size-4" aria-hidden="true" />
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
                          onConfirm={() => void withdrawLink(link)}
                        />
                      )}
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">{t("colType")}</dt>
                      <dd className="font-medium">{kindLabel(link.kind)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("redemptionsLabel")}</dt>
                      <dd className="tabular-nums">{usageLabel(link)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("colExpires")}</dt>
                      <dd>
                        {link.expiresAt
                          ? dateFmt.format(new Date(link.expiresAt))
                          : t("linkNeverExpires")}
                      </dd>
                    </div>
                    {link.enterpriseName && (
                      <div>
                        <dt className="text-muted-foreground">{t("colEnterprise")}</dt>
                        <dd className="truncate">{link.enterpriseName}</dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </div>
      <div className="hidden sm:block">
        <DataTable
          columns={columns}
          data={links}
          getRowId={(link) => String(link.id)}
          searchable={(link) =>
            `${link.url} ${link.kind} ${link.enterpriseName ?? ""} ${link.status}`
          }
          searchPlaceholder={t("searchUserInviteLinks")}
          rowActions={(link) => (
            <div className="flex items-center justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t("copyInviteLink")}
                title={t("copyInviteLink")}
                onClick={() => void copyLink(link.url)}
              >
                <CopyIcon className="size-4" aria-hidden="true" />
              </Button>
              {link.status === "active" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t("openMenuAria")}
                    >
                      <MoreHorizontalIcon className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setWithdrawLinkId(link.id)}
                      disabled={busy.has(`${link.id}:withdraw`)}
                    >
                      <BanIcon className="size-4" />
                      {t("withdrawLink")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {link.status === "active" && (
                <AlertModal
                  open={withdrawLinkId === link.id}
                  onOpenChange={(nextOpen) => setWithdrawLinkId(nextOpen ? link.id : null)}
                  title={t("withdrawLinkTitle")}
                  description={t("withdrawLinkDesc")}
                  cancelLabel={t("cancel")}
                  confirmLabel={t("withdrawLink")}
                  destructive
                  pending={busy.has(`${link.id}:withdraw`)}
                  onConfirm={() => void withdrawLink(link)}
                />
              )}
            </div>
          )}
          pageSize={5}
          loading={loading}
          error={error ? { message: error, onRetry } : undefined}
          empty={{ icon: LinkIcon, title: t("noUserInviteLinks") }}
        />
      </div>
    </section>
  );
}
