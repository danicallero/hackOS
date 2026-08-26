"use client";

// Self-service account deletion/anonymization (H54). The server owns the
// eligibility decision; this component only explains and confirms that
// decision, then clears browser-held data after the authenticated operation.

import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertModal } from "@/components/common/alert-modal";
import { SectionCard } from "@/components/common/section-card";
import { clearOfflineQueue } from "@/components/logistics/offline-queue";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { type MessageKey, useLocale } from "@/lib/i18n";
import {
  type AccountRemovalEligibility,
  accountRemovalIdempotencyKey,
  clearWebAccountData,
} from "@/lib/privacy-removal";
import { useMe } from "@/lib/session";

const RETAINED_FIELD_COPY: Record<string, MessageKey> = {
  age: "accountRetainedAge",
  gender: "accountRetainedGender",
  university: "accountRetainedUniversity",
  degree: "accountRetainedDegree",
  "graduation year": "accountRetainedGraduationYear",
  "origin city": "accountRetainedOriginCity",
  "guaranteed venue-presence time": "accountRetainedPresenceTime",
};

function isParticipantInside(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") {
    return false;
  }
  return (error.details as { code?: unknown }).code === "participant_inside";
}

export function DangerZoneCard() {
  const { t } = useLocale();
  const me = useMe();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<AccountRemovalEligibility | null>(null);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

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

  async function finishLocalAccountClosure(pendingCleanup: boolean) {
    try {
      await clearOfflineQueue(me?.id ?? null);
    } catch {
      // Fall back to removing every encrypted queue envelope if deriving the
      // current owner's slot or deleting its IndexedDB key failed. The
      // ciphertext is removed even when the browser blocks key deletion.
      try {
        await clearOfflineQueue(null);
      } catch {
        // There is no plaintext fallback; sign-out still prevents this
        // account from using any queue that remains in browser storage.
      }
    }
    clearWebAccountData();
    if (pendingCleanup) toast.info(t("accountRemovalPending"));
    try {
      // The API already revoked the session before external cleanup. This is
      // still attempted so Better Auth can clear any remaining browser state.
      await signOut();
    } catch {
      // A revoked/deleted account may make the Better Auth sign-out call fail.
    }
    window.location.assign("/login");
  }

  async function removeAccount() {
    const action = eligibility?.action;
    if (!action) return;
    setPending(true);
    try {
      const headers = { "Idempotency-Key": accountRemovalIdempotencyKey(action) };
      if (action === "delete") {
        await api.delete("/api/me", { headers });
      } else {
        await api.post("/api/me/anonymize", { confirm: true }, { headers });
      }
      toast.success(action === "delete" ? t("accountDeleted") : t("accountAnonymized"));
      await finishLocalAccountClosure(false);
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
        await finishLocalAccountClosure(true);
        return;
      }
      if (isParticipantInside(error)) {
        setConfirmOpen(false);
        try {
          setEligibility(await api.get<AccountRemovalEligibility>("/api/me/removal-eligibility"));
        } catch {
          // Keep the existing explanation if the refresh is unavailable.
        }
      }
      toast.error(error instanceof ApiError ? error.message : t("couldNotRemoveAccount"));
      setPending(false);
    }
  }

  const canConfirm =
    eligibility !== null && !(eligibility.action === "anonymize" && eligibility.requiresVenueExit);

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
              <div>
                <p className="text-muted-foreground text-sm">{t("accountRetainedFieldsIntro")}</p>
                <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                  {eligibility.retainedFields.map((field) => (
                    <li key={field}>
                      {RETAINED_FIELD_COPY[field] ? t(RETAINED_FIELD_COPY[field]) : field}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-muted-foreground text-pretty text-sm">
                {t("accountAnonymizeProofLoss")}
              </p>
              <p className="text-muted-foreground text-pretty text-sm">
                {t("accountAnonymizeNoIdentityMapping")}
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
          onOpenChange={setConfirmOpen}
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
            eligibility.action === "delete" ? t("deleteAction") : t("accountAnonymizeAction")
          }
          pending={pending}
          destructive
          reverseActions
          onConfirm={removeAccount}
        >
          {eligibility.action === "anonymize" ? (
            <>
              <p className="text-muted-foreground text-sm">{t("accountRetainedFieldsIntro")}</p>
              <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
                {eligibility.retainedFields.map((field) => (
                  <li key={field}>
                    {RETAINED_FIELD_COPY[field] ? t(RETAINED_FIELD_COPY[field]) : field}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-pretty text-sm">
                {t("accountAnonymizeProofLoss")}
              </p>
              <p className="text-muted-foreground text-pretty text-sm">
                {t("accountAnonymizeNoIdentityMapping")}
              </p>
              {eligibility.activeEventConsequences && (
                <p role="alert" className="text-destructive text-pretty text-sm">
                  {t("accountAnonymizeActiveEvent")}
                </p>
              )}
            </>
          ) : (
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-pretty text-sm">
              <li>{t("accountAccessRevokedConsequence")}</li>
              <li>{t("freshAccountRemovedConsequence")}</li>
              <li>{t("cantBeUndone")}</li>
            </ul>
          )}
        </AlertModal>
      )}
    </SectionCard>
  );
}
