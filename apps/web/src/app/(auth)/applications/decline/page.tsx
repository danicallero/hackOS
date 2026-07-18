"use client";

// Public spot-decline landing page (H15). The acceptance email links here with
// ?token=… (service.ts builds ${WEB_URL}/applications/decline?token=…) so an
// applicant who can't make it frees their spot in one click — no sign-in
// required. A second click is idempotent (already_declined).

import { CalendarXIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface DeclineResult {
  status: string;
  already_declined: boolean;
}

function DeclineInner() {
  const token = useSearchParams().get("token");
  const { t } = useLocale();
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [result, setResult] = useState<DeclineResult | null>(null);
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
      .post<DeclineResult>("/api/applications/decline", { token })
      .then((res) => {
        setResult(res);
        setState("done");
      })
      .catch((err) => {
        setErrorMsg(err instanceof ApiError ? err.message : t("declineFailed"));
        setState("error");
      });
  }, [token, t]);

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-6" />
          <p className="text-muted-foreground text-sm">{t("releasingPlace")}</p>
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
          <CardTitle>{t("declineFailed")}</CardTitle>
          <CardDescription>{errorMsg}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button asChild variant="outline">
            <Link href="/my-applications">{t("goToApplications")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const alreadyDone = result?.already_declined;
  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
          <CalendarXIcon className="size-6" />
        </div>
        <CardTitle>{alreadyDone ? t("alreadyReleased") : t("placeReleased")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-center">
        <Button asChild variant="outline">
          <Link href="/my-applications">{t("viewApplications")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DeclineSpotPage() {
  return (
    <Suspense>
      <DeclineInner />
    </Suspense>
  );
}
