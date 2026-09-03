"use client";

import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { shortDateTimeFmt } from "@/lib/datetime";
import { type Translate, useLocale } from "@/lib/i18n";

const dateFmt = shortDateTimeFmt;

type FixtureAccount = {
  fixtureKey: string;
  kind: "participant" | "staff";
  email: string;
};

type RegenerateResponse = {
  generation: number;
  accounts: FixtureAccount[];
  staticDeletionPinConfigured: true;
};

type FixtureStatusAccount = Omit<FixtureAccount, "email"> & {
  email: string | null;
  active: boolean;
  lastAuthenticatedAt: string | null;
  lastAuthenticatedIp: string | null;
};

type FixtureStatusResponse = {
  generation: number;
  accounts: FixtureStatusAccount[];
};

function fixtureKindLabel(kind: FixtureAccount["kind"], t: Translate): string {
  return kind === "staff" ? t("staff") : t("participant");
}

function formatLastSignIn(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFmt.format(date);
}

/** Admin-only control for the synthetic accounts used by App Store review. */
export function ReviewFixturesDialog() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RegenerateResponse | null>(null);
  const [status, setStatus] = useState<FixtureStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatusLoading(true);
    api
      .get<FixtureStatusResponse>("/api/admin/review-fixtures")
      .then((response) => {
        if (active) setStatus(response);
      })
      .catch(() => {
        if (active) setStatus(null);
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  function openFlow() {
    setResult(null);
    setOpen(true);
  }

  function closeFlow() {
    if (!pending) {
      setConfirmOpen(false);
      setOpen(false);
    }
  }

  async function regenerate() {
    setPending(true);
    try {
      const response = await api.post<RegenerateResponse>(
        "/api/admin/review-fixtures/regenerate",
        {},
        { headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      setResult(response);
      setStatus({
        generation: response.generation,
        accounts: response.accounts.map((account) => ({
          ...account,
          active: true,
          lastAuthenticatedAt: null,
          lastAuthenticatedIp: null,
        })),
      });
      setConfirmOpen(false);
      toast.success(t("reviewFixturesRegenerated"));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("reviewFixturesRegenerateFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={openFlow}>
        <ShieldCheckIcon aria-hidden="true" />
        {t("reviewFixturesButton")}
      </Button>

      <Modal
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) openFlow();
          else closeFlow();
        }}
        title={t("reviewFixturesTitle")}
        description={t("reviewFixturesDescription")}
        icon={ShieldCheckIcon}
        size="xl"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeFlow} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => setConfirmOpen(true)} disabled={pending}>
              <RefreshCwIcon aria-hidden="true" />
              {t("reviewFixturesRegenerate")}
            </Button>
          </>
        }
      >
        <div className="space-y-4 pb-1">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">{t("reviewFixturesWhatChanges")}</p>
            <p className="text-muted-foreground mt-1 text-pretty">
              {t("reviewFixturesWhatChangesDescription")}
            </p>
          </div>
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{t("reviewFixturesUsage")}</p>
                <p className="text-muted-foreground mt-1 text-pretty">
                  {t("reviewFixturesUsageDescription")}
                </p>
              </div>
              {status && status.generation > 0 && (
                <StatusBadge tone="neutral" dot={false}>
                  {t("reviewFixturesGeneration", { generation: status.generation })}
                </StatusBadge>
              )}
            </div>
            {statusLoading ? (
              <p className="text-muted-foreground">{t("reviewFixturesUsageLoading")}</p>
            ) : status ? (
              <ul className="divide-y rounded-md border">
                {status.accounts.map((account) => {
                  const available = account.active && account.email !== null;
                  return (
                    <li key={account.fixtureKey} className="space-y-3 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-pretty">{account.fixtureKey}</p>
                          <p className="text-muted-foreground mt-1 text-xs">
                            {fixtureKindLabel(account.kind, t)}
                          </p>
                        </div>
                        <StatusBadge tone={available ? "success" : "neutral"} dot={false}>
                          {available
                            ? t("reviewFixturesAvailable")
                            : t("reviewFixturesUnavailable")}
                        </StatusBadge>
                      </div>
                      <div className="min-w-0">
                        <p className="text-muted-foreground text-xs font-medium">
                          {t("reviewFixturesAddress")}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs">
                          {account.email ?? (
                            <span className="text-muted-foreground font-sans">
                              {t("reviewFixturesNoAddress")}
                            </span>
                          )}
                        </p>
                      </div>
                      <dl className="grid gap-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-muted-foreground text-xs font-medium">
                            {t("reviewFixturesLastSignIn")}
                          </dt>
                          <dd className="mt-1 text-sm tabular-nums">
                            {account.lastAuthenticatedAt
                              ? formatLastSignIn(account.lastAuthenticatedAt)
                              : t("reviewFixturesNeverUsed")}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-muted-foreground text-xs font-medium">
                            {t("reviewFixturesIpOrigin")}
                          </dt>
                          <dd className="mt-1 break-all font-mono text-xs">
                            <bdi>{account.lastAuthenticatedIp ?? "—"}</bdi>
                          </dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t("reviewFixturesUsageUnavailable")}</p>
            )}
          </div>
          {result && (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="success" dot={false}>
                  {t("reviewFixturesGeneration", { generation: result.generation })}
                </StatusBadge>
                <span className="text-muted-foreground text-sm">
                  {t("reviewFixturesCredentialsHint")}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <AlertModal
        open={confirmOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !pending) setConfirmOpen(false);
        }}
        title={t("reviewFixturesConfirmTitle")}
        description={t("reviewFixturesConfirmDescription")}
        cancelLabel={t("cancel")}
        confirmLabel={t("reviewFixturesRegenerate")}
        pending={pending}
        destructive
        reverseActions
        onConfirm={regenerate}
      />
    </>
  );
}
