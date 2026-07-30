"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
import { authClient } from "@/lib/auth-client";
import { type Translate, useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";

function forgotPasswordSchema(t: Translate) {
  return z.object({ email: z.string().email(t("validEmail")) });
}
type Values = z.infer<ReturnType<typeof forgotPasswordSchema>>;

function ForgotPasswordForm() {
  const params = useSearchParams();
  const rawNext = params.get("next");
  const { t } = useLocale();
  const [sent, setSent] = useState(false);
  const schema = useMemo(() => forgotPasswordSchema(t), [t]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    // QoL: prefill with the email carried over from the sign-in screen.
    defaultValues: { email: params.get("email") ?? "" },
  });

  async function onSubmit(values: Values) {
    // H5: the response is identical whether or not the email exists — never
    // reveal registration status. We always show the confirmation.
    // Carries the interrupted destination through to /reset-password so it
    // can hand it to /login after the new password is set (H188).
    try {
      const { error } = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: withReturnPath(`${window.location.origin}/reset-password`, rawNext),
      });
      if (error) {
        form.setError("root", { message: t("couldNotSendResetEmail") });
        return;
      }
      setSent(true);
    } catch {
      form.setError("root", { message: t("couldNotSendResetEmail") });
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <MailCheckIcon aria-hidden="true" className="size-6" />
          </div>
          <CardTitle>{t("checkEmail")}</CardTitle>
          <CardDescription>{t("resetEmailSent")}</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link
            href={withReturnPath("/login", rawNext)}
            className="text-sm underline underline-offset-4"
          >
            {t("backToSignIn")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("resetPassword")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive" role="alert">
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
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              {t("sendResetLink")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        {t("rememberedIt")}{" "}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          {t("signIn")}
        </Link>
      </div>
    </Card>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
