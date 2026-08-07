"use client";

import { CheckCircle2Icon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/common/qr-code";
import { Spinner } from "@/components/common/spinner";
import { WalletButtons } from "@/components/common/wallet-buttons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { isConfirmExpiredError, useTokenAction } from "../lib";

// Public spot-confirmation landing page (H15). The acceptance email links here
// with ?token=… (service.ts builds ${WEB_URL}/applications/confirm?token=…).
// It POSTs the token to the public confirm route — no sign-in required — and
// shows the outcome. A second click is idempotent (already_confirmed).
//
// The email token is an identity assertion, never a session (issue #369): the
// page's primary action is putting the ticket in Apple/Google Wallet using the
// scoped credential the confirm hands back, and any session already open in
// this browser is closed — whether it belonged to this applicant or to someone
// else. Reaching the app itself always goes through a fresh sign-in.

interface ConfirmResult {
  status: string;
  already_confirmed: boolean;
  ticket_token: string | null;
  user_id: number;
  masked_email: string;
  wallet_token: string;
  wallet_token_expires_at: string;
}

/** Which notice to show about the session we just ended, if any. */
type SessionNotice = "none" | "ended" | "other_account";

function ConfirmInner() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const { t } = useLocale();
  const { me, status: sessionStatus, refresh } = useSessionContext();
  const {
    state,
    result,
    errorMsg,
    linkInvalid,
    retry: submit,
  } = useTokenAction<ConfirmResult>({
    token,
    endpoint: "/api/applications/confirm",
    isExpired: isConfirmExpiredError,
    invalidLinkMessage: t("confirmationLinkInvalidDesc"),
    fallbackMessage: t("confirmationFailed"),
  });
  const [sessionNotice, setSessionNotice] = useState<SessionNotice>("none");
  const [showQr, setShowQr] = useState(false);
  const endedSession = useRef(false);

  // No session leakage (issue #369): opening the email link ends whatever
  // session this browser had. If it belonged to a different account, the
  // ticket added is still the token's owner — we just say so, and the person
  // is sent to sign in as them.
  useEffect(() => {
    if (state !== "done" || sessionStatus !== "authenticated" || endedSession.current) return;
    endedSession.current = true;
    const wasOtherAccount = me != null && result != null && me.id !== result.user_id;
    void (async () => {
      await signOut().catch(() => {});
      await refresh();
      setSessionNotice(wasOtherAccount ? "other_account" : "ended");
    })();
  }, [state, sessionStatus, me, result, refresh]);

  const goToApp = useCallback(async () => {
    await signOut().catch(() => {});
    await refresh();
    router.push("/login");
  }, [refresh, router]);

  if (state === "loading") {
    return (
      <Card aria-busy="true">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-6" />
          <p role="status" className="text-muted-foreground text-sm">
            {t("confirmingPlace")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (state === "expired") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-warning/10 text-warning mb-2 grid size-12 place-items-center rounded-full">
            <TriangleAlertIcon aria-hidden="true" className="size-6" />
          </div>
          <CardTitle>{t("confirmationExpiredTitle")}</CardTitle>
          <CardDescription role="alert">{t("confirmationExpiredDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          {!linkInvalid && (
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => void submit()}
            >
              {t("retry")}
            </Button>
          )}
          <Button asChild className="w-full sm:w-auto">
            <Link href="/my-applications">{t("goToApplications")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
            <TriangleAlertIcon aria-hidden="true" className="size-6" />
          </div>
          <CardTitle>
            {linkInvalid ? t("confirmationLinkInvalidTitle") : t("confirmationFailed")}
          </CardTitle>
          <CardDescription role="alert">{errorMsg}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/my-applications">{t("goToApplications")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const alreadyDone = result?.already_confirmed;
  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
          <CheckCircle2Icon aria-hidden="true" className="size-6" />
        </div>
        <CardTitle>{alreadyDone ? t("alreadyConfirmed") : t("placeConfirmed")}</CardTitle>
        <CardDescription>{t("ticketWalletFirstDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {sessionNotice !== "none" && (
          <Alert>
            <InfoIcon aria-hidden="true" className="size-4" />
            <AlertTitle>
              {sessionNotice === "other_account"
                ? t("confirmOtherAccountTitle")
                : t("confirmSessionEndedTitle")}
            </AlertTitle>
            <AlertDescription>
              {sessionNotice === "other_account"
                ? t("confirmOtherAccountDesc", { email: result?.masked_email ?? "" })
                : t("confirmSessionEndedDesc")}
            </AlertDescription>
          </Alert>
        )}

        {/* Primary action: the pass, not the QR (issue #369). No nested
            container — this card IS the section (DESIGN.md §3). */}
        <section className="space-y-3 text-center">
          <div className="space-y-1">
            <h2 className="type-section-title text-balance">{t("walletAddTicket")}</h2>
            <p className="text-muted-foreground text-sm">{t("walletAddTicketHint")}</p>
          </div>
          {result?.wallet_token ? (
            <div className="flex justify-center">
              <WalletButtons purpose="ticket" accessToken={result.wallet_token} />
            </div>
          ) : null}
        </section>

        {/* The QR stays reachable for anyone who can't use a wallet app. */}
        <div className="space-y-3 text-center">
          <Button
            type="button"
            variant="ghost"
            className="w-full sm:w-auto"
            aria-expanded={showQr}
            onClick={() => setShowQr((open) => !open)}
          >
            {showQr ? t("hideTicketCode") : t("showTicketCode")}
          </Button>
          {showQr && (
            <QrCode
              value={result?.ticket_token}
              label={t("entranceTicket")}
              className="mx-auto max-w-sm"
            />
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button type="button" className="w-full sm:w-auto" onClick={() => void goToApp()}>
            {t("goToApp")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ConfirmSpotPage() {
  return (
    <Suspense fallback={<ConfirmLoadingCard />}>
      <ConfirmInner />
    </Suspense>
  );
}

function ConfirmLoadingCard() {
  const { t } = useLocale();
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Spinner className="size-6" />
        <p role="status" className="text-muted-foreground text-sm">
          {t("confirmingPlace")}
        </p>
      </CardContent>
    </Card>
  );
}
