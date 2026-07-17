"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { SubmitButton } from "@/components/common/submit-button";
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
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";

const schema = z
  .object({
    password: z.string().min(8, "At least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

type Values = z.infer<typeof schema>;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const rawNext = params.get("next");
  const { t } = useLocale();
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
      form.setError("root", {
        message: error.message ?? t("resetLinkInvalid"),
      });
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
                <p className="text-destructive text-sm">{form.formState.errors.root.message}</p>
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
