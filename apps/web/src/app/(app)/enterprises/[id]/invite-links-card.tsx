"use client";

import { EVENTS } from "@hackos/shared/events";
import { LinkIcon, PlusIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { StatusBadge } from "@/components/common/status-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { EnterpriseInviteLink } from "@/lib/types";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_TONE: Record<
  EnterpriseInviteLink["status"],
  "success" | "warning" | "danger" | "neutral"
> = {
  active: "success",
  expired: "warning",
  exhausted: "warning",
  withdrawn: "danger",
};

export function InviteLinksCard({ enterpriseId }: { enterpriseId: number }) {
  const { t } = useLocale();
  const [links, setLinks] = useState<EnterpriseInviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [maxRedeems, setMaxRedeems] = useState("");
  const [expiryMinutes, setExpiryMinutes] = useState("10080");
  const [neverExpires, setNeverExpires] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [withdrawId, setWithdrawId] = useState<number | null>(null);
  const [withdrawPending, setWithdrawPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<EnterpriseInviteLink[]>("/api/invites/enterprise-links", {
        query: { enterpriseId },
      });
      setLinks(data);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : t("couldNotLoadEnterpriseInviteLinks");
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [enterpriseId, t]);

  const liveRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, liveRefresh]);

  function resetForm() {
    setMaxRedeems("");
    setExpiryMinutes("10080");
    setNeverExpires(false);
    setFormError(null);
  }

  async function createLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsedMax = maxRedeems.trim() ? Number(maxRedeems) : null;
    const parsedExpiry = expiryMinutes.trim() ? Number(expiryMinutes) : NaN;
    if (parsedMax !== null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
      setFormError(t("maxRedeemsDesc"));
      return;
    }
    if (!neverExpires && (!Number.isInteger(parsedExpiry) || parsedExpiry < 1)) {
      setFormError(t("expiryMinutesDesc"));
      return;
    }

    setCreatePending(true);
    try {
      await api.post<EnterpriseInviteLink>("/api/invites/enterprise-links", {
        enterpriseId,
        maxRedeems: parsedMax,
        expiresInMinutes: neverExpires ? null : parsedExpiry,
      });
      setCreateOpen(false);
      resetForm();
      toast.success(t("linkCreated"));
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("couldNotCreateEnterpriseInviteLink"));
    } finally {
      setCreatePending(false);
    }
  }

  async function withdrawLink() {
    if (withdrawId === null) return;
    setWithdrawPending(true);
    try {
      await api.post(`/api/invites/enterprise-links/${withdrawId}/withdraw`);
      setWithdrawId(null);
      toast.success(t("linkWithdrawn"));
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("couldNotWithdrawLink"));
    } finally {
      setWithdrawPending(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("copied"));
    } catch {
      toast.error(t("couldNotCopyLink"));
    }
  }

  return (
    <SectionCard
      icon={LinkIcon}
      title={t("enterpriseInviteLinks")}
      description={t("enterpriseInviteLinksDesc")}
      action={
        <Button className="w-full sm:w-auto" onClick={() => setCreateOpen(true)}>
          <PlusIcon aria-hidden="true" /> {t("createEnterpriseInviteLink")}
        </Button>
      }
    >
      {createOpen && (
        <form
          id="enterprise-invite-link-form"
          onSubmit={createLink}
          className="space-y-4 rounded-lg border p-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-link-max-redeems">{t("maxRedeemsLabel")}</Label>
              <Input
                id="invite-link-max-redeems"
                type="number"
                name="maxRedeems"
                min="1"
                step="1"
                inputMode="numeric"
                value={maxRedeems}
                onChange={(event) => setMaxRedeems(event.target.value)}
                aria-describedby="invite-link-max-redeems-help"
                placeholder={t("unlimitedRedeems")}
              />
              <p id="invite-link-max-redeems-help" className="text-muted-foreground text-xs">
                {t("maxRedeemsDesc")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-link-expiry-minutes">{t("expiryMinutesLabel")}</Label>
              <Input
                id="invite-link-expiry-minutes"
                type="number"
                name="expiresInMinutes"
                min="1"
                step="1"
                inputMode="numeric"
                value={expiryMinutes}
                onChange={(event) => setExpiryMinutes(event.target.value)}
                disabled={neverExpires}
                aria-describedby="invite-link-expiry-help"
              />
              <p id="invite-link-expiry-help" className="text-muted-foreground text-xs">
                {t("expiryMinutesDesc")}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="invite-link-never-expires"
              checked={neverExpires}
              onCheckedChange={(checked) => setNeverExpires(checked === true)}
            />
            <Label htmlFor="invite-link-never-expires" className="leading-5">
              {t("neverExpiresLabel")}
            </Label>
          </div>
          {formError && (
            <p role="alert" className="text-destructive text-sm">
              {formError}
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
            <SubmitButton
              form="enterprise-invite-link-form"
              pending={createPending}
              className="w-full sm:w-auto"
            >
              {t("createLink")}
            </SubmitButton>
          </div>
        </form>
      )}

      {loadError ? (
        <div role="alert" className="text-destructive flex flex-wrap items-center gap-3 text-sm">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {t("retry")}
          </Button>
        </div>
      ) : loading ? (
        <p className="text-muted-foreground text-sm">{t("loading")}</p>
      ) : links.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noEnterpriseInviteLinks")}</p>
      ) : (
        <div className="space-y-4">
          {links.map((link) => {
            const statusLabel =
              link.status === "active"
                ? t("linkStatusActive")
                : link.status === "expired"
                  ? t("linkStatusExpired")
                  : link.status === "exhausted"
                    ? t("linkStatusExhausted")
                    : t("linkStatusWithdrawn");
            return (
              <article key={link.id} className="space-y-4 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <StatusBadge tone={STATUS_TONE[link.status]}>{statusLabel}</StatusBadge>
                    <span className="text-muted-foreground text-sm">
                      {link.maxRedeems === null
                        ? t("redeemedUnlimitedLabel", { used: link.redeemedCount })
                        : t("redeemedCountLabel", {
                            used: link.redeemedCount,
                            maximum: link.maxRedeems,
                          })}
                    </span>
                  </div>
                  {link.status === "active" && (
                    <AlertModal
                      trigger={
                        <Button type="button" variant="outline" size="sm">
                          {t("withdrawLink")}
                        </Button>
                      }
                      open={withdrawId === link.id}
                      onOpenChange={(open) => setWithdrawId(open ? link.id : null)}
                      title={t("withdrawLinkTitle")}
                      description={t("withdrawLinkDesc")}
                      cancelLabel={t("cancel")}
                      confirmLabel={t("withdrawLink")}
                      destructive
                      pending={withdrawPending}
                      onConfirm={() => void withdrawLink()}
                    />
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    value={link.url}
                    readOnly
                    aria-label={t("copyInviteLink")}
                    className="min-w-0 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("copyInviteLink")}
                    title={t("copyInviteLink")}
                    onClick={() => void copyLink(link.url)}
                  >
                    <LinkIcon aria-hidden="true" />
                  </Button>
                </div>
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t("linkExpiresAt")}</dt>
                    <dd>
                      {link.expiresAt
                        ? dateFmt.format(new Date(link.expiresAt))
                        : t("linkNeverExpires")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t("redemptionsLabel")}</dt>
                    <dd className="tabular-nums">
                      {link.remainingRedeems === null
                        ? t("unlimitedRedeems")
                        : link.remainingRedeems}
                    </dd>
                  </div>
                </dl>
                <div className="border-t pt-3">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <UserRoundIcon aria-hidden="true" className="size-4" /> {t("redemptionsLabel")}
                  </h3>
                  {link.redemptions.length === 0 ? (
                    <p className="text-muted-foreground text-sm">{t("noRedemptionsYet")}</p>
                  ) : (
                    <ul className="divide-border divide-y">
                      {link.redemptions.map((redemption) => (
                        <li
                          key={redemption.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-medium">
                              {redemption.name || redemption.email}
                            </span>{" "}
                            <span className="text-muted-foreground">({redemption.email})</span>
                          </span>
                          <time
                            className="text-muted-foreground shrink-0"
                            dateTime={redemption.redeemedAt}
                          >
                            {dateFmt.format(new Date(redemption.redeemedAt))}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
