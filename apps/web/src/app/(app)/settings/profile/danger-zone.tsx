"use client";

// Self-service account deletion/anonymization (H54). The server owns the
// eligibility decision; this component only explains and confirms that
// decision, then clears browser-held data after the authenticated operation.

import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { clearOfflineQueue } from "@/components/logistics/offline-queue";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import {
  type AccountRemovalEligibility,
  type AccountRemovalProgress,
  accountRemovalIdempotencyKey,
  clearWebAccountData,
  saveAccountRemovalProgress,
} from "@/lib/privacy-removal";
import { useMe } from "@/lib/session";

export function DangerZoneCard() {
  const { t } = useLocale();
  const me = useMe();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<AccountRemovalEligibility | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [pinSent, setPinSent] = useState(false);
  const [pinMode, setPinMode] = useState<"email" | "static" | null>(null);
  const [securityPin, setSecurityPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<AccountRemovalEligibility>("/api/me/removal-eligibility")
      .then((result) => {
        if (active) setEligibility(result);
      })
      .catch(() => {
        if (active) setEligibility(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function finishLocalAccountClosure(
    action: AccountRemovalProgress["action"],
    pendingCleanup: boolean,
    message?: string,
    progress?: AccountRemovalProgress,
  ) {
    let localCleanupFailed = false;
    try {
      await clearOfflineQueue(me?.id ?? null);
    } catch {
      // Fall back to removing every encrypted queue envelope if deriving the
      // current owner's slot or deleting its IndexedDB key failed. The
      // ciphertext is removed even when the browser blocks key deletion.
      try {
        await clearOfflineQueue(null);
      } catch {
        localCleanupFailed = true;
      }
    }
    clearWebAccountData();
    const savedProgress =
      progress ??
      (localCleanupFailed ? { action, status: "device_cleanup_pending" as const } : null);
    if (savedProgress) saveAccountRemovalProgress(savedProgress);
    if (pendingCleanup || message || localCleanupFailed) {
      toast.info(
        message ??
          t(localCleanupFailed ? "accountRemovalDeviceCleanupPending" : "accountRemovalPending"),
      );
    }
    try {
      // The API already revoked the session before external cleanup. This is
      // still attempted so Better Auth can clear any remaining browser state.
      await signOut();
    } catch {
      // A revoked/deleted account may make the Better Auth sign-out call fail.
    }
    window.location.assign("/login");
  }

  function resetPinFlow() {
    setPinSent(false);
    setPinMode(null);
    setSecurityPin("");
    setPinError(null);
  }

  function handleConfirmOpenChange(nextOpen: boolean) {
    setConfirmOpen(nextOpen);
    if (!nextOpen) {
      setPending(false);
      resetPinFlow();
    }
  }

  async function removeAccount() {
    const action = eligibility?.action;
    if (!action) return;
    setPending(true);
    setPinError(null);
    try {
      if (eligibility.securityPinRequired && !pinSent) {
        const pinResult = await api.post<{ status: "sent" | "static" | "not_required" }>(
          "/api/me/removal-pin",
        );
        if (pinResult.status === "static") {
          setPinSent(true);
          setPinMode("static");
          toast.info(t("accountRemovalPinStaticSent"));
          setPending(false);
          return;
        }
        if (pinResult.status === "sent") {
          setPinSent(true);
          setPinMode("email");
          toast.info(t("accountRemovalPinSent"));
          setPending(false);
          return;
        }
      }
      if (eligibility.securityPinRequired && pinSent && !/^\d{6}$/.test(securityPin)) {
        setPinError(t("accountRemovalPinInvalid"));
        setPending(false);
        return;
      }
      const headers = { "Idempotency-Key": accountRemovalIdempotencyKey(action) };
      let result: { status: "completed" | "pending_exit" | "processing" };
      if (action === "delete") {
        result = await api.delete<typeof result>("/api/me", {
          headers,
          body: securityPin ? { securityPin } : undefined,
        });
      } else {
        result = await api.post<typeof result>(
          "/api/me/anonymize",
          { confirm: true, ...(securityPin ? { securityPin } : {}) },
          { headers },
        );
      }
      const progress =
        result.status === "completed" ? undefined : { action, status: result.status };
      if (result.status === "completed") {
        toast.success(action === "delete" ? t("accountDeleted") : t("accountAnonymized"));
      }
      await finishLocalAccountClosure(
        action,
        progress !== undefined,
        progress?.status === "pending_exit"
          ? action === "anonymize"
            ? t("accountAnonymizePendingExit")
            : t("accountRemovalPendingExit")
          : progress
            ? t("accountRemovalPending")
            : undefined,
        progress,
      );
    } catch (error) {
      // A network failure has an ambiguous outcome: the API may have revoked
      // the account and the browser may simply have lost the response. Clear
      // local identity data and sign out for ambiguous failures, just as for
      // the explicit 503 cleanup-pending response. Business 4xx errors remain
      // on the page so the participant can fix the stated issue (for example,
      // recording their venue exit first).
      const ambiguousOutcome =
        !(error instanceof ApiError) ||
        error.code === "removal_storage_pending" ||
        error.status >= 500;
      if (ambiguousOutcome) {
        await finishLocalAccountClosure(action, true, undefined, { action, status: "processing" });
        return;
      }
      if (error instanceof ApiError && error.code === "removal_pin_expired") {
        setPinSent(false);
        setPinMode(null);
        setSecurityPin("");
        setPinError(t("accountRemovalPinExpired"));
      } else if (
        error instanceof ApiError &&
        ["removal_pin_invalid", "removal_pin_required"].includes(error.code)
      ) {
        setPinError(t("accountRemovalPinInvalid"));
      } else {
        toast.error(error instanceof ApiError ? error.message : t("couldNotRemoveAccount"));
      }
      setPending(false);
    }
  }

  const canConfirm = eligibility !== null;

  return (
    <SectionCard icon={TriangleAlertIcon} title={t("dangerZone")}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <ChevronDownIcon aria-hidden className={open ? "size-4 rotate-180" : "size-4"} />
            {open ? t("hideDangerZone") : t("showDangerZone")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("checkingRemovalEligibility")}</p>
          ) : eligibility?.action === "delete" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-pretty text-sm">
                {t("deleteMyAccountDesc")}
              </p>
              {eligibility.requiresVenueExit && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountRemovalExitRequired")}
                </p>
              )}
              {eligibility.integrityWarning && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountRemovalIntegrityWarning")}
                </p>
              )}
              <p className="text-muted-foreground text-sm">
                <Link href="/privacy" className="underline underline-offset-2">
                  {t("privacyPolicy")}
                </Link>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                {t("deleteMyAccount")}
              </Button>
            </div>
          ) : eligibility ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-pretty text-sm">
                {t("accountAnonymizeDescription")}
              </p>
              {eligibility.activeEventConsequences && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountAnonymizeActiveEvent")}
                </p>
              )}
              {eligibility.requiresVenueExit && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountAnonymizeExitRequired")}
                </p>
              )}
              {eligibility.integrityWarning && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountRemovalIntegrityWarning")}
                </p>
              )}
              <p className="text-muted-foreground text-sm">
                <Link href="/privacy" className="underline underline-offset-2">
                  {t("privacyPolicy")}
                </Link>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!canConfirm}
                onClick={() => setConfirmOpen(true)}
              >
                {t("accountAnonymizeAction")}
              </Button>
            </div>
          ) : (
            <p role="alert" className="text-destructive text-pretty text-sm">
              {t("removalEligibilityUnavailable")}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {eligibility && (
        <AlertModal
          open={confirmOpen}
          onOpenChange={handleConfirmOpenChange}
          title={
            eligibility.action === "delete"
              ? t("deleteMyAccountConfirmTitle")
              : t("accountAnonymizeConfirmTitle")
          }
          description={
            eligibility.action === "delete"
              ? t("areYouSureCantBeUndone")
              : t("accountAnonymizeConfirmBody")
          }
          cancelLabel={t("cancel")}
          confirmLabel={
            eligibility.securityPinRequired && !pinSent
              ? t("accountRemovalSendPin")
              : eligibility.action === "delete"
                ? t("deleteAction")
                : t("accountAnonymizeAction")
          }
          pending={pending}
          destructive
          reverseActions
          onConfirm={removeAccount}
        >
          {eligibility.securityPinRequired ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {pinSent
                  ? pinMode === "static"
                    ? t("accountRemovalPinStaticDescription")
                    : t("accountRemovalPinDescription")
                  : t("accountRemovalPinPrompt")}
              </p>
              {pinSent ? (
                <div className="space-y-2">
                  <Label htmlFor="account-removal-security-pin">
                    {t("accountRemovalPinLabel")}
                  </Label>
                  <Input
                    id="account-removal-security-pin"
                    aria-describedby={pinError ? "account-removal-security-pin-error" : undefined}
                    aria-invalid={pinError ? true : undefined}
                    autoComplete="one-time-code"
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => {
                      setSecurityPin(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setPinError(null);
                    }}
                    placeholder="000000"
                    value={securityPin}
                  />
                  {pinError ? (
                    <p
                      id="account-removal-security-pin-error"
                      role="alert"
                      className="text-destructive text-sm"
                    >
                      {pinError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : eligibility.action === "anonymize" ? (
            <p className="text-muted-foreground text-sm">
              <Link href="/privacy" className="underline underline-offset-2">
                {t("privacyPolicy")}
              </Link>
            </p>
          ) : (
            <>
              <p className="text-muted-foreground mb-2 text-sm">
                <Link href="/privacy" className="underline underline-offset-2">
                  {t("privacyPolicy")}
                </Link>
              </p>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
                <li>{t("accountAccessRevokedConsequence")}</li>
                <li>{t("freshAccountRemovedConsequence")}</li>
                {eligibility.requiresVenueExit && <li>{t("accountRemovalExitRequired")}</li>}
                <li>{t("cantBeUndone")}</li>
              </ul>
            </>
          )}
        </AlertModal>
      )}
    </SectionCard>
  );
}
