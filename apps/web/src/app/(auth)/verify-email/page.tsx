"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, MailIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type Values = z.infer<typeof schema>;

/** Maps Better Auth's verify-email error codes to friendly copy (H2). */
function messageForError(
  error: string | null,
  t: (key: string) => string,
): { title: string; body: string } | null {
  if (!error) return null;
  return { title: t("verifyEmail"), body: t("verificationInstructions") };
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t } = useLocale();
  const { refresh } = useSessionContext();
  // On failure Better Auth appends `error` to the same callback URL (which
  // already carries verified=1), so an error must take precedence.
  const errorInfo = messageForError(params.get("error"), t);
  const verified =
    !errorInfo && (params.get("verified") !== null || params.get("status") === "verified");
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Verification auto-signs-in (autoSignInAfterVerification): pick up the new
  // session so the user is logged in without a second sign-in.
  useEffect(() => {
    if (verified) void refresh();
  }, [verified, refresh]);

  async function onSubmit(values: Values) {
    try {
      await api.post("/api/auth/resend-verification", { email: values.email });
      toast.success(t("verificationEmailSent"));
      setCooldown(60); // H3: 60s between attempts
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setCooldown(err.retryAfter ?? 60);
        form.setError("root", { message: err.message });
        return;
      }
      form.setError("root", {
        message: err instanceof ApiError ? err.message : t("couldNotSendEmail"),
      });
    }
  }

  if (verified) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircle2Icon className="size-6" />
          </div>
          <CardTitle>{t("emailVerified")}</CardTitle>
          <CardDescription>{t("emailVerifiedDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button onClick={() => router.push("/dashboard")}>{t("continueToDashboard")}</Button>
          <Link
            href="/login"
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
          <MailIcon className="size-6" />
        </div>
        <CardTitle>{t("verifyEmail")}</CardTitle>
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            {form.formState.errors.root && (
              <p className="text-destructive text-sm">{form.formState.errors.root.message}</p>
            )}
            <SubmitButton
              className="w-full"
              pending={form.formState.isSubmitting}
              disabled={cooldown > 0}
            >
              {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resendVerificationEmail")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        <Link href="/login" className="text-foreground underline underline-offset-4">
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
