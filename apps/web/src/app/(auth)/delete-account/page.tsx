"use client";

// "I didn't create this account" landing page (H1, H54). Every verification
// reminder email links here with ?token=…. The token only identifies the
// account; deleting it still needs its current password, and no emailed PIN
// (the address is unverified). Loading the page is read-only so link scanners
// cannot delete anything.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { apiErrorReason } from "@/lib/api-error-reason";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; email: string; passwordRequired: boolean }
  | { kind: "invalid" }
  | { kind: "verified" }
  | { kind: "deleted" }
  | { kind: "error"; message: string };

function DeleteAccountInner() {
  const token = useSearchParams().get("token");
  const { t } = useLocale();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!token) {
      setPhase({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    api
      .get<{ email: string; passwordRequired: boolean }>(
        `/api/unverified-account-removal?token=${encodeURIComponent(token)}`,
      )
      .then(({ email, passwordRequired }) => {
        if (!cancelled) setPhase({ kind: "ready", email, passwordRequired });
      })
      .catch((err) => {
        if (cancelled) return;
        const reason = apiErrorReason(err);
        if (reason === "account_already_verified") setPhase({ kind: "verified" });
        else if (reason === "removal_link_invalid") setPhase({ kind: "invalid" });
        else setPhase({ kind: "error", message: apiErrorText(err, t, t("couldNotRemoveAccount")) });
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token || phase.kind !== "ready") return;
    if (phase.passwordRequired && !password) {
      setPasswordError(t("accountRemovalPasswordRequired"));
      return;
    }
    setPending(true);
    try {
      await api.post("/api/unverified-account-removal", {
        token,
        ...(phase.passwordRequired ? { password } : {}),
      });
      setPhase({ kind: "deleted" });
    } catch (err) {
      const reason = apiErrorReason(err);
      if (reason === "removal_reauthentication_invalid") {
        setPasswordError(t("accountRemovalPasswordInvalid"));
      } else if (reason === "account_already_verified") {
        setPhase({ kind: "verified" });
      } else if (reason === "removal_link_invalid") {
        setPhase({ kind: "invalid" });
      } else {
        setPasswordError(apiErrorText(err, t, t("couldNotRemoveAccount")));
      }
      if (!(err instanceof ApiError)) console.error("[auth:unverified-removal] failed", err);
    } finally {
      setPending(false);
    }
  }

  if (phase.kind === "loading") {
    return (
      <Card aria-busy="true">
        <CardContent className="flex justify-center py-10">
          <Spinner className="size-6" />
        </CardContent>
      </Card>
    );
  }

  if (phase.kind === "deleted") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <CardTitle>{t("accountDeleted")}</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (phase.kind !== "ready") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <CardTitle>
            {phase.kind === "verified"
              ? t("removalLinkVerifiedTitle")
              : t("removalLinkInvalidTitle")}
          </CardTitle>
          {phase.kind === "error" ? (
            <CardDescription role="alert">{phase.message}</CardDescription>
          ) : (
            <CardDescription>
              {phase.kind === "verified"
                ? t("removalLinkVerifiedDesc")
                : t("removalLinkInvalidDesc")}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="text-center">
          <Button asChild variant="outline">
            <Link href="/login">{t("backToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <CardTitle>{t("deleteUnverifiedAccountTitle")}</CardTitle>
        <CardDescription>
          {t("deleteUnverifiedAccountBody", { email: phase.email })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {phase.passwordRequired ? (
            <div className="space-y-2">
              <Label htmlFor="unverified-removal-password">
                {t("accountRemovalPasswordLabel")}
              </Label>
              <Input
                id="unverified-removal-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                maxLength={128}
                value={password}
                aria-invalid={passwordError ? true : undefined}
                aria-describedby={passwordError ? "unverified-removal-password-error" : undefined}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError(null);
                }}
              />
              {passwordError ? (
                <p
                  id="unverified-removal-password-error"
                  role="alert"
                  className="text-destructive text-sm"
                >
                  {passwordError}
                </p>
              ) : null}
            </div>
          ) : null}
          <SubmitButton variant="destructive" className="w-full" pending={pending}>
            {t("deleteAccount")}
          </SubmitButton>
        </form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        <Link
          href={`/verify-email?email=${encodeURIComponent(phase.email)}`}
          className="text-foreground underline underline-offset-4"
        >
          {t("verifyEmailInstead")}
        </Link>
      </div>
    </Card>
  );
}

export default function DeleteAccountPage() {
  return (
    <Suspense>
      <DeleteAccountInner />
    </Suspense>
  );
}
