"use client";

// Applicant confirmation and outcome states (H12, H15): keep the place decision
// separate from the editable answer form so each state remains easy to scan.

import { CheckCircle2Icon, ShieldAlertIcon, WalletCardsIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { ContextualError } from "@/components/common/contextual-error";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { type ActionError, fmtDateTime, type MyResponseDetail } from "../lib";

interface ApplicationStatusActionsProps {
  response: MyResponseDetail | null;
  status: string | undefined;
  canConfirm: boolean;
  acting: boolean;
  actionError: ActionError | null;
  privacyNotice: string | null;
  onConfirm: () => void;
  onOpenRelease: () => void;
  onRetry: () => void;
}

export function ApplicationStatusActions({
  response,
  status,
  canConfirm,
  acting,
  actionError,
  privacyNotice,
  onConfirm,
  onOpenRelease,
  onRetry,
}: ApplicationStatusActionsProps) {
  const { t, language } = useLocale();

  return (
    <>
      {canConfirm && (
        <SectionCard
          icon={CheckCircle2Icon}
          title={t("youreInConfirmTitle")}
          description={t("youreInConfirmDesc")}
        >
          {response?.confirmation_expires_at && (
            <p className="text-sm font-medium tabular-nums">
              {t("deadlineLabel", {
                date: fmtDateTime(response.confirmation_expires_at, language),
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={onConfirm} disabled={acting} className="w-full sm:w-auto">
              {acting && <Spinner />}
              {t("confirmPlace")}
            </Button>
            <Button
              variant="outline"
              onClick={onOpenRelease}
              disabled={acting}
              className="w-full sm:w-auto"
            >
              {t("declineInvite")}
            </Button>
          </div>
        </SectionCard>
      )}

      {status === "confirmed" && (
        <SectionCard icon={CheckCircle2Icon} title={t("placeConfirmed")}>
          <p className="text-muted-foreground text-sm">{t("canReleaseAnytime")}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/wallet">
                <WalletCardsIcon aria-hidden="true" />
                {t("viewTicket")}
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={onOpenRelease}
              disabled={acting}
              className="w-full sm:w-auto"
            >
              <XCircleIcon aria-hidden="true" />
              {t("cantAttendRelease")}
            </Button>
          </div>
        </SectionCard>
      )}

      {actionError && (actionError.action === "confirm" || actionError.action === "decline") && (
        <ContextualError message={actionError.message} onRetry={onRetry} />
      )}
      {status === "declined" && (
        <Alert role="status">
          <XCircleIcon aria-hidden="true" />
          <AlertTitle>{t("declinedThisPlaceTitle")}</AlertTitle>
          <AlertDescription>{t("declinedThisPlaceDesc")}</AlertDescription>
        </Alert>
      )}
      {status === "expired" && (
        <Alert role="status">
          <XCircleIcon aria-hidden="true" />
          <AlertTitle>{t("confirmationExpiredTitle")}</AlertTitle>
          <AlertDescription>{t("confirmationExpiredDesc")}</AlertDescription>
        </Alert>
      )}

      {privacyNotice && (
        <Alert role="status">
          <ShieldAlertIcon aria-hidden="true" />
          <AlertTitle>{t("privacyNoticeTitle")}</AlertTitle>
          <AlertDescription>{privacyNotice}</AlertDescription>
        </Alert>
      )}
    </>
  );
}
