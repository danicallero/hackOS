"use client";

import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
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
// page offers the ticket in Apple/Google Wallet using the scoped credential
// the confirm hands back. The holder's current session remains active;
// a session belonging to another account is closed.

interface ConfirmResult {
  status: string;
  already_confirmed: boolean;
  ticket_token: string | null;
  user_id: number;
  masked_email: string;
  holder_name?: string;
  wallet_token: string;
  wallet_token_expires_at: string;
}

/** Which notice to show about the session we just ended, if any. */
type SessionNotice = "none" | "other_account";

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
  const [sessionError, setSessionError] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const endedSession = useRef(false);

  // H15 / #369: preserve the ticket holder’s own session; close a different
  // account’s session. Scoped Wallet requests always use the token’s owner.
  useEffect(() => {
    if (state !== "done" || sessionStatus !== "authenticated" || endedSession.current) return;
    if (!me || !result) return;
    endedSession.current = true;
    if (me.id === result.user_id) {
      void refresh();
      return;
    }
    void (async () => {
      try {
        const response = await signOut();
        if (response.error) throw new Error(response.error.message);
        await refresh();
        setSessionNotice("other_account");
      } catch {
        setSessionError(true);
      }
    })();
  }, [state, sessionStatus, me, result, refresh]);

  const goToApp = useCallback(async () => {
    setNavigating(true);
    try {
      if (sessionStatus === "authenticated" && me?.id === result?.user_id) {
        router.push("/schedule");
        return;
      }
      if (sessionStatus === "authenticated") {
        const response = await signOut();
        if (response.error) throw new Error(response.error.message);
        await refresh();
      }
      router.push("/login");
    } catch {
      setSessionError(true);
    } finally {
      setNavigating(false);
    }
  }, [sessionStatus, me, result, refresh, router]);

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
            <WarningIcon aria-hidden="true" className="size-6" />
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
            <WarningIcon aria-hidden="true" className="size-6" />
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
  const holderName = result?.holder_name || result?.masked_email;
  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-success/10 text-success grid size-10 shrink-0 -translate-y-1 place-items-center rounded-full">
            <CheckCircleIcon aria-hidden="true" className="size-5" />
          </div>
          <h1 className="type-page-title text-balance">
            {alreadyDone ? t("alreadyConfirmed") : t("placeConfirmed")}
          </h1>
        </div>
        {holderName && (
          <div className="space-y-1">
            <p className="type-section-title break-words">{holderName}</p>
            {result?.holder_name && (
              <p className="text-muted-foreground text-sm">{result.masked_email}</p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {sessionNotice === "other_account" && (
          <Alert>
            <InfoIcon aria-hidden="true" className="size-4" />
            <AlertTitle>{t("confirmOtherAccountTitle")}</AlertTitle>
            <AlertDescription>
              {t("confirmOtherAccountDesc", { email: result?.masked_email ?? "" })}
            </AlertDescription>
          </Alert>
        )}
        {sessionError && (
          <Alert variant="destructive">
            <AlertDescription role="alert">{t("confirmSignOutFailed")}</AlertDescription>
          </Alert>
        )}
        {result?.ticket_token && (
          <div className="grid items-center gap-8 sm:grid-cols-[minmax(0,1fr)_240px]">
            <section className="space-y-4">
              <div className="space-y-2">
                <h2 className="type-section-title text-balance">{t("walletAddTicket")}</h2>
                <p className="text-muted-foreground text-sm">{t("confirmTicketAtDoor")}</p>
              </div>
              {result.wallet_token && (
                <WalletButtons
                  purpose="ticket"
                  accessToken={result.wallet_token}
                  className="flex-col items-start"
                />
              )}
              {result.wallet_token && (
                <p className="text-muted-foreground text-xs">{t("confirmWalletLinkExpiry")}</p>
              )}
            </section>
            <QrCode
              value={result.ticket_token}
              label={t("entranceTicket")}
              variant="plain"
              showValue={false}
              className="mx-auto w-full max-w-60"
            />
          </div>
        )}
        <div className="flex justify-start">
          <Button
            type="button"
            disabled={navigating || sessionStatus === "loading"}
            onClick={() => void goToApp()}
          >
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
