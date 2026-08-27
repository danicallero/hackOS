"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertModal } from "@/components/common/alert-modal";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { clearAccountRemovalProgress } from "@/lib/privacy-removal";
import type { Me } from "@/lib/types";

type RemovalState = Exclude<Me["removal"], null>;

export function PendingRemovalScreen({
  removal,
  onRefresh,
}: {
  removal: RemovalState;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(Date.now());
  const [cancelOpen, setCancelOpen] = useState(false);
  const [exitHelpOpen, setExitHelpOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expiresAt = removal.expiresAt ? Date.parse(removal.expiresAt) : Number.NaN;
  const secondsRemaining = Number.isFinite(expiresAt)
    ? Math.max(0, Math.ceil((expiresAt - now) / 1_000))
    : null;
  const countdown = useMemo(
    () =>
      secondsRemaining == null
        ? t("accountRemovalExpiryUnknown")
        : formatCountdown(secondsRemaining),
    [secondsRemaining, t],
  );
  const pendingExit = removal.status === "pending_exit";
  const processing = removal.status === "processing" || secondsRemaining === 0;
  const canCancel = pendingExit && !processing;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshTimer = setInterval(() => void onRefresh(), 15_000);
    return () => clearInterval(refreshTimer);
  }, [onRefresh]);

  useEffect(() => {
    if (secondsRemaining === 0) void onRefresh();
  }, [onRefresh, secondsRemaining]);

  async function cancel() {
    if (!canCancel || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await api.post<{ status: "cancelled" }>("/api/me/anonymize/cancel", {});
      clearAccountRemovalProgress();
      setCancelOpen(false);
      await onRefresh();
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        ["removal_expired", "removal_exit_recorded", "removal_not_cancellable"].includes(cause.code)
      ) {
        setCancelOpen(false);
        await onRefresh();
      } else {
        setError(cause instanceof Error ? cause.message : t("accountRemovalCancelError"));
      }
    } finally {
      setCancelling(false);
    }
  }

  async function endSession() {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message || t("couldNotSignOut"));
      window.location.assign("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("couldNotSignOut"));
      setSigningOut(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <section
        aria-labelledby="pending-removal-title"
        className="w-full max-w-lg space-y-6 rounded-lg border bg-background p-6 shadow-sm"
      >
        <div className="space-y-2">
          <p className="text-primary text-sm font-semibold">hackOS</p>
          <h1 id="pending-removal-title" className="text-balance text-2xl font-semibold">
            {t(processing ? "accountRemovalProcessingTitle" : "accountRemovalPendingTitle")}
          </h1>
          <p className="text-muted-foreground text-pretty">
            {t(
              processing
                ? "accountRemovalProcessingDescription"
                : "accountRemovalPendingDescription",
            )}
          </p>
        </div>

        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 rounded-md border p-4 text-sm"
        >
          {t(processing ? "accountRemovalProcessingBody" : "accountRemovalPendingBody")}
        </p>

        {!processing && (
          <div aria-live="polite" role="status" className="rounded-md border bg-muted/30 p-4">
            <p className="text-muted-foreground text-sm">{t("accountRemovalExpiryLabel")}</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{countdown}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t("accountRemovalExpiryHint")}</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        {!processing && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={() => setExitHelpOpen(true)}>
              {t("accountRemovalLogExit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canCancel || cancelling}
              onClick={() => setCancelOpen(true)}
            >
              {t("accountRemovalCancel")}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <Link href="/privacy" className="text-muted-foreground underline underline-offset-2">
            {t("privacyPolicy")}
          </Link>
          <Button
            type="button"
            variant="ghost"
            disabled={signingOut}
            onClick={() => void endSession()}
          >
            {t("signOut")}
          </Button>
        </div>
      </section>

      <AlertModal
        open={exitHelpOpen}
        onOpenChange={setExitHelpOpen}
        title={t("accountRemovalLogExitTitle")}
        description={t("accountRemovalLogExitBody")}
        cancelLabel={t("close")}
        confirmLabel={t("close")}
        autoClose
        onConfirm={() => setExitHelpOpen(false)}
      />
      <AlertModal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("accountRemovalCancelTitle")}
        description={t("accountRemovalCancelBody")}
        cancelLabel={t("keepAnonymization")}
        confirmLabel={t("accountRemovalCancel")}
        pending={cancelling}
        onConfirm={() => void cancel()}
      />
    </main>
  );
}

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}h ${minutes.toString().padStart(2, "0")}m`
    : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
