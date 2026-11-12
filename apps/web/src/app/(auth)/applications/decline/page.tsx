"use client";

// Public spot-decline landing page (H15). The acceptance email links here with
// #token=… so a link scanner's GET cannot release a place. The visitor must
// press the button; the bearer token is sent in the POST body.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmailLinkToken } from "@/hooks/use-email-link-token";
import { useLocale } from "@/lib/i18n";
import { isDeclineExpiredError, useTokenAction } from "../lib";

interface DeclineResult {
  status: string;
  already_declined: boolean;
}

function DeclineInner() {
  const token = useEmailLinkToken(useSearchParams().get("token"));
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

  if (state === "ready" || state === "used") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {state === "used" ? t("confirmationLinkUsedTitle") : t("releaseYourPlace")}
          </CardTitle>
          <CardDescription>
            {state === "used" ? t("confirmationLinkUsedDesc") : t("releaseEmailPlaceDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state === "ready" && (
            <Button
              type="button"
              variant="destructive"
              disabled={!token}
              onClick={() => void submit()}
            >
              {t("yesReleaseMyPlace")}
            </Button>
          )}
          {!token && <p role="alert">{t("confirmationLinkInvalidDesc")}</p>}
        </CardContent>
      </Card>
    );
  }

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
