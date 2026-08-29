"use client";

import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signIn } from "@/lib/auth-client";
import { type Translate, useLocale } from "@/lib/i18n";
import {
  type AccountRemovalProgress,
  clearAccountRemovalProgress,
  readAccountRemovalProgress,
} from "@/lib/privacy-removal";
import { safeReturnPath, withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

type Values = { email: string; password: string };

type AuthError = { code?: string; status?: number; message?: string };

/** Keep Better Auth details in diagnostics while presenting stable H4 copy. */
function localizedSignInError(error: AuthError, t: Translate): string {
  const code = error.code?.toUpperCase();
  console.error("[auth:sign-in] request failed", {
    code,
    status: error.status,
    error,
  });

  if (code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401) {
    return t("incorrectCredentials");
  }
  if (code === "EMAIL_NOT_VERIFIED") return t("emailNotVerified");
  if (code === "INVALID_EMAIL") return t("validEmail");
  return t("couldNotSignIn");
}

function LoginInner() {
  const router = useRouter();
  const rawNext = useSearchParams().get("next");
  const next = safeReturnPath(rawNext);
  const { status, refresh } = useSessionContext();
  const { t } = useLocale();
  const [removalProgress, setRemovalProgress] = useState<AccountRemovalProgress | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(
      z.object({
        email: z.string().email(t("validEmail")),
        password: z.string().min(1, t("required")),
      }),
    ),
    defaultValues: { email: "", password: "" },
  });

  const emailValue = useWatch({ control: form.control, name: "email" });

  // Already signed in: bounce straight to the destination instead of showing
  // the form again — /login isn't admin-only, any signed-in user lands here.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  useEffect(() => {
    setRemovalProgress(readAccountRemovalProgress());
  }, []);

  function dismissRemovalProgress() {
    clearAccountRemovalProgress();
    setRemovalProgress(null);
  }

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function onSubmit(values: Values) {
    const { error } = await signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      form.setError("root", { message: localizedSignInError(error, t) });
      return;
    }
    await refresh();
    // The authenticated-status effect above owns the post-login transition
    // (including ?next). A second push here can race a pending sign-out route.
  }

  const forgotHref = withReturnPath(
    emailValue ? `/forgot-password?email=${encodeURIComponent(emailValue)}` : "/forgot-password",
    rawNext,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("welcomeBack")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {removalProgress ? (
              <Alert>
                <AlertDescription>
                  <p>
                    {removalProgress.status === "pending_exit"
                      ? t("accountRemovalPendingExit")
                      : removalProgress.status === "device_cleanup_pending"
                        ? t("accountRemovalDeviceCleanupPending")
                        : t("accountRemovalPending")}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <Link href="/privacy" className="underline underline-offset-2">
                      {t("privacyPolicy")}
                    </Link>
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={dismissRemovalProgress}
                    >
                      {t("dismiss")}
                    </button>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
            {form.formState.errors.root && (
              <Alert data-testid={UI_TEST_IDS.auth.error} variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input
                      data-testid={UI_TEST_IDS.auth.email}
                      type="email"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>{t("password")}</FormLabel>
                    <Link
                      href={forgotHref}
                      className="text-muted-foreground text-xs underline underline-offset-4"
                    >
                      {t("forgotPassword")}
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput
                      data-testid={UI_TEST_IDS.auth.password}
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton
              data-testid={UI_TEST_IDS.auth.submit}
              className="w-full"
              pending={form.formState.isSubmitting}
            >
              {t("signIn")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-muted-foreground justify-center border-t text-center text-sm">
        {t("newToHackos")}{" "}
        <Link
          href={withReturnPath("/signup", rawNext)}
          className="text-foreground underline underline-offset-4"
        >
          {t("createAccount")}
        </Link>
      </CardFooter>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
