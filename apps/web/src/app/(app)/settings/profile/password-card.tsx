"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon } from "lucide-react";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PasswordInput } from "@/components/common/password-input";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
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
import { toast } from "@/lib/toast";

type AuthError = { code?: string };

function passwordSchema(t: Translate) {
  return z
    .object({
      currentPassword: z.string().min(1, t("currentPasswordRequired")),
      newPassword: z.string().min(8, t("atLeastEight")),
      confirmPassword: z.string(),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      message: t("passwordsDontMatch"),
      path: ["confirmPassword"],
    });
}

type Values = z.infer<ReturnType<typeof passwordSchema>>;

export function PasswordCard() {
  const { t } = useLocale();
  const schema = useMemo(() => passwordSchema(t), [t]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: Values) {
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      // Keep this browser signed in with Better Auth's replacement session,
      // while closing every other session that could still hold the old secret.
      revokeOtherSessions: true,
    });
    if (error) {
      if ((error as AuthError).code?.toUpperCase() === "INVALID_PASSWORD") {
        form.setError("currentPassword", { message: t("currentPasswordIncorrect") });
      } else if ((error as AuthError).code?.toUpperCase() === "PASSWORD_TOO_SHORT") {
        form.setError("newPassword", { message: t("atLeastEight") });
      } else {
        form.setError("root", { message: t("couldNotChangePassword") });
      }
      return;
    }

    form.reset();
    toast.success(t("passwordChanged"));
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <SectionCard
          icon={KeyRoundIcon}
          title={t("changePassword")}
          footer={
            <SubmitButton pending={form.formState.isSubmitting}>{t("updatePassword")}</SubmitButton>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("currentPassword")}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
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
              name="confirmPassword"
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
          </div>
          {form.formState.errors.root && (
            <p className="text-destructive text-sm" role="alert">
              {form.formState.errors.root.message}
            </p>
          )}
        </SectionCard>
      </form>
    </Form>
  );
}
