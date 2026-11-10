"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useEmailLinkToken } from "@/hooks/use-email-link-token";
import { useVerificationResend } from "@/hooks/use-verification-resend";
import { API_URL } from "@/lib/env";
import { type Translate, useLocale } from "@/lib/i18n";
import { safeReturnPath, withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

function verifyEmailSchema(t: Translate) {
  return z.object({ email: z.string().email(t("validEmail")) });
}
type Values = z.infer<ReturnType<typeof verifyEmailSchema>>;

/**
 * Maps Better Auth's verify-email error codes to distinct, actionable copy
 * (H2): an expired link and an outright invalid one are different situations
 * for the person reading the page, even though both fall back to the same
 * resend form below. An already-used link is NOT an error state here —
 * Better Auth's verify endpoint treats re-verifying an already-verified
 * account as success (H2 "si ya lo usé, se me dice que ya estoy verificado"),
 * so it never reaches this function at all.
 */
function messageForError(
  error: string | null,
  t: Translate,
): { title: string; body: string } | null {
  if (!error) return null;
  if (error === "TOKEN_EXPIRED") {
    return { title: t("verifyLinkExpiredTitle"), body: t("verifyLinkExpiredDesc") };
  }
  return { title: t("verifyLinkInvalidTitle"), body: t("verifyLinkInvalidDesc") };
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useLocale();
  const { refresh } = useSessionContext();
  const schema = useMemo(() => verifyEmailSchema(t), [t]);
  // On failure Better Auth appends `error` to the same callback URL (which
  // already carries verified=1), so an error must take precedence.
  const errorInfo = messageForError(params.get("error"), t);
  const verified =
    !errorInfo && (params.get("verified") !== null || params.get("status") === "verified");
  // Where to send the person after a successful verification or a resend
  // (#188): the application or other same-origin destination they were
  // originally interrupted from, falling back to the schedule.
  const rawNext = params.get("next");
  const next = safeReturnPath(rawNext, "/event");
  // The emailed link lands here with the token in the fragment. Link scanners
  // may GET the page, but only the explicit form POST verifies the address.
  const token = useEmailLinkToken(params.get("token"));

  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "" },
  });
  // Keep the interrupted destination alive across a resend too (#188).
  const { cooldown, error, resend, resending } = useVerificationResend(
    form.watch("email"),
    rawNext ? `/verify-email?verified=1&next=${encodeURIComponent(next)}` : undefined,
  );

  // Verification auto-signs-in (autoSignInAfterVerification): pick up the new
  // session so the user is logged in without a second sign-in.
  useEffect(() => {
    if (verified) void refresh();
  }, [verified, refresh]);

  if (token && !errorInfo && !verified) {
    const callback = safeReturnPath(params.get("callback"), "/verify-email?verified=1");
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
            <EnvelopeSimpleIcon aria-hidden="true" className="size-6" />
          </div>
          <h1 className="type-section-title text-balance">{t("verifyEmail")}</h1>
        </CardHeader>
        <CardContent>
          <form method="post" action={`${API_URL}/api/auth/verify-email/confirm`}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="callback" value={callback} />
            <Button className="w-full" type="submit">
              {t("confirmEmail")}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (verified) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircleIcon aria-hidden="true" className="size-6" />
          </div>
          <h1 className="type-section-title text-balance">{t("emailVerified")}</h1>
          <CardDescription>{t("emailVerifiedDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button onClick={() => router.push(next)}>
            {next === "/timetable" ? t("continueToSchedule") : t("continueToDestination")}
          </Button>
          <Link
            href={withReturnPath("/login", rawNext)}
            className="text-muted-foreground text-sm underline underline-offset-4"
          >
            {t("differentAccount")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
          <EnvelopeSimpleIcon aria-hidden="true" className="size-6" />
        </div>
        <h1 className="type-section-title text-balance">{t("verifyEmail")}</h1>
        <CardDescription>{t("verificationInstructions")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorInfo && (
          <Alert variant="destructive">
            <AlertTitle>{errorInfo.title}</AlertTitle>
            <AlertDescription>{errorInfo.body}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(resend)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <SubmitButton className="w-full" pending={resending} disabled={cooldown > 0}>
              {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resendVerificationEmail")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        <Link
          href={withReturnPath("/login", rawNext)}
          className="text-foreground underline underline-offset-4"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
