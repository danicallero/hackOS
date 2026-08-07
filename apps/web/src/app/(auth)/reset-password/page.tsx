"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { authClient } from "@/lib/auth-client";
import { type Translate, useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";

type AuthError = { code?: string; status?: number; message?: string };

/** Keep Better Auth details in diagnostics while preserving H5 recovery copy. */
function localizedResetError(error: AuthError, t: Translate): string {
  const code = error.code?.toUpperCase();
  console.error("[auth:reset-password] request failed", {
    code,
    status: error.status,
    error,
  });

  if (code === "PASSWORD_TOO_SHORT") return t("atLeastEight");
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return t("resetLinkInvalid");
  // No reset-specific copy exists for other Better Auth statuses yet.
  return t("resetLinkInvalid");
}

function resetPasswordSchema(t: Translate) {
  return z
    .object({
      password: z.string().min(8, t("atLeastEight")),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      message: t("passwordsDontMatch"),
      path: ["confirm"],
    });
}

type Values = z.infer<ReturnType<typeof resetPasswordSchema>>;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const rawNext = params.get("next");
  const { t } = useLocale();
  const schema = useMemo(() => resetPasswordSchema(t), [t]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  async function onSubmit(values: Values) {
    if (!token) {
      form.setError("root", { message: t("resetTokenMissing") });
      return;
    }
    const { error } = await authClient.resetPassword({ newPassword: values.password, token });
    if (error) {
      form.setError("root", { message: localizedResetError(error, t) });
      return;
    }
    // H5: resetting closes all old sessions server-side; send them to sign in,
    // carrying whatever they were trying to reach before recovery (H188).
    toast.success(t("passwordUpdated"));
    router.push(withReturnPath("/login", rawNext));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("setNewPassword")}</CardTitle>
      </CardHeader>
      <CardContent>
        {!token ? (
          <p className="text-destructive text-sm">
            {t("resetTokenMissing")}{" "}
            <Link
              href={withReturnPath("/forgot-password", rawNext)}
              className="underline underline-offset-4"
            >
              {t("resetPassword").toLowerCase()}
            </Link>
            .
          </p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("newPassword")}</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("confirmPassword")}</FormLabel>
                    <FormControl>
                      <PasswordInput autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {form.formState.errors.root && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
                </Alert>
              )}
              <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
                {t("updatePassword")}
              </SubmitButton>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
