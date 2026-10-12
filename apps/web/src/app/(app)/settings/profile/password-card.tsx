"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Modal } from "@/components/common/modal";
import { PasswordInput } from "@/components/common/password-input";
import { SectionCard } from "@/components/common/section-card";
import { SubmitButton } from "@/components/common/submit-button";
import { Button } from "@/components/ui/button";
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
  const [open, setOpen] = useState(false);
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
    setOpen(false);
    toast.success(t("passwordChanged"), { compactTitle: t("toastChangePassword") });
  }

  return (
    <SectionCard title={t("changePassword")}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("updatePassword")}
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (form.formState.isSubmitting) return;
          setOpen(next);
          if (!next) form.reset();
        }}
        title={t("changePassword")}
        icon={KeyIcon}
      >
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
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
            <SubmitButton pending={form.formState.isSubmitting}>{t("updatePassword")}</SubmitButton>
          </form>
        </Form>
      </Modal>
    </SectionCard>
  );
}
