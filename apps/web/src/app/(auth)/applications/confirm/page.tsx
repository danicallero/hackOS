"use client";

// Public spot-confirmation landing page (H15). The acceptance email links here
// with ?token=… (service.ts builds ${WEB_URL}/applications/confirm?token=…).
// It POSTs the token to the public confirm route — no sign-in required — and
// shows the outcome. A second click is idempotent (already_confirmed).

import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { QrCode } from "@/components/common/qr-code";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface ConfirmResult {
  status: string;
  already_confirmed: boolean;
  ticket_token: string | null;
}

function ConfirmInner() {
  const token = useSearchParams().get("token");
  const { t } = useLocale();
  const [state, setState] = useState<"loading" | "done" | "error" | "expired">("loading");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [linkInvalid, setLinkInvalid] = useState(false);
  const ran = useRef(false);
  const idempotencyKey = useRef<string | null>(null);

  const submit = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    setLinkInvalid(false);
    if (!token) {
      setLinkInvalid(true);
      setErrorMsg(t("confirmationLinkInvalidDesc"));
      setState("error");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const res = await api.post<ConfirmResult>(
        "/api/applications/confirm",
        { token },
        {
          headers: { "Idempotency-Key": idempotencyKey.current },
        },
      );
      setResult(res);
      setState("done");
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.details &&
        typeof err.details === "object" &&
        ((err.details as { code?: unknown }).code === "confirmation_expired" ||
          (err.details as { expired?: unknown }).expired === true)
      ) {
        setState("expired");
        return;
      }
      if (err instanceof ApiError && err.code === "not_found") {
        setLinkInvalid(true);
        setErrorMsg(t("confirmationLinkInvalidDesc"));
      } else {
        setErrorMsg(err instanceof ApiError ? err.message : t("confirmationFailed"));
      }
      setState("error");
    }
  }, [t, token]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void submit();
  }, [submit]);

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
        <CardDescription>{t("ticketReadyDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-center">
        <QrCode
          value={result?.ticket_token}
          label={t("entranceTicket")}
          className="mx-auto max-w-sm"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/wallet">{t("viewTicket")}</Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/my-applications">{t("viewApplications")}</Link>
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
