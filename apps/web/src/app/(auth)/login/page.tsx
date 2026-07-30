"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useLocale } from "@/lib/i18n";
import { safeReturnPath, withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

type Values = { email: string; password: string };

function LoginInner() {
  const router = useRouter();
  const rawNext = useSearchParams().get("next");
  const next = safeReturnPath(rawNext);
  const { status, refresh } = useSessionContext();
  const { t } = useLocale();
  const form = useForm<Values>({
    resolver: zodResolver(
      z.object({
        email: z.string().email(t("validEmail")),
        password: z.string().min(1, t("required")),
      }),
    ),
    defaultValues: { email: "", password: "" },
  });

  // Already signed in: bounce straight to the destination instead of showing
  // the form again — /login isn't admin-only, any signed-in user lands here.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

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
      const message =
        error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401
          ? t("incorrectCredentials")
          : (error.message ?? t("couldNotSignIn"));
      form.setError("root", { message });
      return;
    }
    await refresh();
    // The authenticated-status effect above owns the post-login transition
    // (including ?next). A second push here can race a pending sign-out route.
  }

  const emailValue = form.watch("email");
  const forgotHref = withReturnPath(
    emailValue ? `/forgot-password?email=${encodeURIComponent(emailValue)}` : "/forgot-password",
    rawNext,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("welcomeBack")}</CardTitle>
        <CardDescription>{t("signInDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
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
                    <Input type="email" autoComplete="email" {...field} />
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
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              {t("signIn")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        {t("newToHackos")}{" "}
        <Link
          href={withReturnPath("/signup", rawNext)}
          className="text-foreground underline underline-offset-4"
        >
          {t("createAccount")}
        </Link>
      </div>
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
