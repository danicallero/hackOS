"use client";

import { CheckCircle2Icon, MailWarningIcon, UserRoundXIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

type PreviewResult = {
  matchesAccount: boolean;
  secondaryEmail: string | null;
  alreadyUsed: boolean;
  expired: boolean;
};

type State =
  | { status: "loading" }
  | { status: "wrongAccount" }
  | { status: "confirm"; secondaryEmail: string }
  | { status: "verifying" }
  | { status: "ok"; already: boolean }
  | { status: "error"; message: string };

function VerifySecondaryInner() {
  const { t } = useLocale();
  const router = useRouter();
  const token = useSearchParams().get("token");
  const { me, refresh } = useSessionContext();
  const [state, setState] = useState<State>({ status: "loading" });

  const runVerify = useCallback(
    async (tok: string) => {
      setState({ status: "verifying" });
      try {
        const r = await api.post<{ status: true; alreadyVerified: boolean }>(
          "/api/me/secondary-email/verify",
          { token: tok },
        );
        await refresh();
        setState({ status: "ok", already: r.alreadyVerified });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : t("couldNotVerifyLink"),
        });
      }
    },
    [refresh, t],
  );

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: t("linkMissingToken") });
      return;
    }
    api
      .get<PreviewResult>("/api/me/secondary-email/verify", { query: { token } })
      .then((preview) => {
        if (!preview.matchesAccount) {
          setState({ status: "wrongAccount" });
          return;
        }
        // Nothing left to confirm — hand off to the existing POST, which
        // already renders the right "already verified" / "expired" copy.
        if (preview.alreadyUsed || preview.expired) {
          void runVerify(token);
          return;
        }
        setState({ status: "confirm", secondaryEmail: preview.secondaryEmail ?? "" });
      })
      .catch((err) =>
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : t("couldNotVerifyLink"),
        }),
      );
  }, [token, t, runVerify]);

  const switchAccount = useCallback(async () => {
    await signOut().catch(() => {});
    await refresh();
    router.push(
      withReturnPath("/login", `/verify-secondary-email?token=${encodeURIComponent(token ?? "")}`),
    );
  }, [refresh, router, token]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        {state.status === "loading" || state.status === "verifying" ? (
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <Spinner className="size-6" />
            <p className="text-muted-foreground text-sm">{t("verifyingSecondaryEmail")}</p>
          </CardContent>
        ) : state.status === "confirm" ? (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
                <MailWarningIcon className="size-6" />
              </div>
              <CardTitle>{t("confirmSecondaryEmailTitle")}</CardTitle>
              <CardDescription>
                {t("confirmSecondaryEmailDesc", {
                  secondaryEmail: state.secondaryEmail,
                  primaryEmail: me?.email ?? "",
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-center">
              <Button
                type="button"
                onClick={() => token && void runVerify(token)}
                className="w-full"
              >
                {t("confirmAndVerify")}
              </Button>
              <Button asChild variant="outline">
                <Link href="/settings/profile">{t("cancel")}</Link>
              </Button>
            </CardContent>
          </>
        ) : state.status === "wrongAccount" ? (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
                <UserRoundXIcon className="size-6" />
              </div>
              <CardTitle>{t("wrongAccountTitle")}</CardTitle>
              <CardDescription>
                {t("wrongAccountDesc", { currentEmail: me?.email ?? "" })}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button onClick={() => void switchAccount()}>{t("differentAccount")}</Button>
            </CardContent>
          </>
        ) : state.status === "ok" ? (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
                <CheckCircle2Icon className="size-6" />
              </div>
              <CardTitle>{t("secondaryEmailVerified")}</CardTitle>
              <CardDescription>
                {state.already ? t("alreadyVerifiedAddress") : t("willUseToMatchDevpost")}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild>
                <Link href="/settings/profile">{t("backToProfile")}</Link>
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
                <MailWarningIcon className="size-6" />
              </div>
              <CardTitle>{t("couldntVerifyTitle")}</CardTitle>
              <CardDescription>{state.message}</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild variant="outline">
                <Link href="/settings/profile">{t("backToProfile")}</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

export default function VerifySecondaryEmailPage() {
  return (
    <Suspense>
      <VerifySecondaryInner />
    </Suspense>
  );
}
