"use client";

// Public spot-confirmation landing page (H15). The acceptance email links here
// with ?token=… (service.ts builds ${WEB_URL}/applications/confirm?token=…).
// It POSTs the token to the public confirm route — no sign-in required — and
// shows the outcome. A second click is idempotent (already_confirmed).

import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
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
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setErrorMsg(t("linkMissingToken"));
      setState("error");
      return;
    }
    api
      .post<ConfirmResult>("/api/applications/confirm", { token })
      .then((res) => {
        setResult(res);
        setState("done");
      })
      .catch((err) => {
        setErrorMsg(err instanceof ApiError ? err.message : t("confirmationFailed"));
        setState("error");
      });
  }, [token, t]);

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-6" />
          <p className="text-muted-foreground text-sm">{t("confirmingPlace")}</p>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
            <TriangleAlertIcon className="size-6" />
          </div>
          <CardTitle>{t("confirmationFailed")}</CardTitle>
          <CardDescription>{errorMsg}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <p className="text-muted-foreground text-sm"></p>
          <Button asChild>
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
          <CheckCircle2Icon className="size-6" />
        </div>
        <CardTitle>{alreadyDone ? t("alreadyConfirmed") : t("placeConfirmed")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-center">
        <Button asChild>
          <Link href="/my-applications">{t("viewApplications")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function ConfirmSpotPage() {
  return (
    <Suspense>
      <ConfirmInner />
    </Suspense>
  );
}
