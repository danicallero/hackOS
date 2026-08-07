"use client";

// Public spot-decline landing page (H15). The acceptance email links here with
// ?token=… (service.ts builds ${WEB_URL}/applications/decline?token=…) so an
// applicant who can't make it frees their spot in one click — no sign-in
// required. A second click is idempotent (already_declined).

import { CalendarXIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n";
import { isDeclineExpiredError, useTokenAction } from "../lib";

interface DeclineResult {
  status: string;
  already_declined: boolean;
}

function DeclineInner() {
  const token = useSearchParams().get("token");
  const { t } = useLocale();
  const {
    state,
    result,
    errorMsg,
    linkInvalid,
    retry: submit,
  } = useTokenAction<DeclineResult>({
    token,
    endpoint: "/api/applications/decline",
    isExpired: isDeclineExpiredError,
    invalidLinkMessage: t("confirmationLinkInvalidDesc"),
    fallbackMessage: t("declineFailed"),
  });

  if (state === "loading") {
    return (
      <Card aria-busy="true">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-6" />
          <p role="status" className="text-muted-foreground text-sm">
            {t("releasingPlace")}
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
            {linkInvalid ? t("confirmationLinkInvalidTitle") : t("declineFailed")}
          </CardTitle>
          <CardDescription role="alert">{errorMsg}</CardDescription>
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
          <Button asChild variant="outline" className="w-full sm:w-auto">
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
          <CalendarXIcon aria-hidden="true" className="size-6" />
        </div>
        <CardTitle>{alreadyDone ? t("alreadyReleased") : t("placeReleased")}</CardTitle>
        <CardDescription>{t("placeReleasedDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-center">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/my-applications">{t("viewApplications")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DeclineSpotPage() {
  return (
    <Suspense fallback={<DeclineLoadingCard />}>
      <DeclineInner />
    </Suspense>
  );
}

function DeclineLoadingCard() {
  const { t } = useLocale();
  return (
    <Card aria-busy="true">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Spinner className="size-6" />
        <p role="status" className="text-muted-foreground text-sm">
          {t("releasingPlace")}
        </p>
      </CardContent>
    </Card>
  );
}
