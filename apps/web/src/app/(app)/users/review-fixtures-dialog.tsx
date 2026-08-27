"use client";

import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { Modal } from "@/components/common/modal";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

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

/** Admin-only control for the synthetic accounts used by App Store review. */
export function ReviewFixturesDialog() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<RegenerateResponse | null>(null);

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
              <ul className="divide-y rounded-md border text-sm">
                {result.accounts.map((account) => (
                  <li
                    key={account.fixtureKey}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="font-medium">{account.fixtureKey}</span>
                    <span className="text-muted-foreground font-mono text-xs">{account.email}</span>
                  </li>
                ))}
              </ul>
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
