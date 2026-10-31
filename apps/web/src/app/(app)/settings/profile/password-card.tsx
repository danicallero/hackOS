"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Modal } from "@/components/common/modal";
import { PasswordInput } from "@/components/common/password-input";
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

export function PasswordRow() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  // Quick search opens this dialog through `?action=password`; the param is
  // consumed on arrival so reloads and shared links do not reopen it (#1182, R003).
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedAction = searchParams.get("action");
  const consumed = useRef(false);
  useEffect(() => {
    if (requestedAction !== "password") {
      consumed.current = false;
      return;
    }
    if (consumed.current) return;
    consumed.current = true;
    setOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("action");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [requestedAction, searchParams, pathname, router]);
  const schema = useMemo(() => passwordSchema(t), [t]);
  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
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
    <li className="flex items-center gap-3 px-4 py-3">
      <KeyIcon aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
      <p className="min-w-0 flex-1 text-sm font-medium">{t("changePassword")}</p>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
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
            <div className="grid items-start gap-4 sm:grid-cols-2">
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
    </li>
  );
}
