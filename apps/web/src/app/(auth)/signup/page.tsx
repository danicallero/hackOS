"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { signUp } from "@/lib/auth-client";
import { LANGS, languageName, type Translate, useLocale } from "@/lib/i18n";
import { safeReturnPath, withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

function signupSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("required")),
    surname: z.string().min(1, t("required")),
    email: z.string().email(t("validEmail")),
    password: z.string().min(8, t("atLeastEight")),
    language: z.enum(["en", "es", "gl"]),
  });
}

type Values = z.infer<ReturnType<typeof signupSchema>>;

function SignUpInner() {
  const router = useRouter();
  const { status } = useSessionContext();
  const { t, language } = useLocale();
  // The application (or other same-origin destination) the visitor was
  // trying to reach — carried through verification so they land back there
  // instead of the dashboard (H188: applicant return-path continuity).
  const rawNext = useSearchParams().get("next");
  const next = safeReturnPath(rawNext, "");
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const schema = useMemo(() => signupSchema(t), [t]);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", surname: "", email: "", password: "", language },
  });

  // Already signed in: no reason to show the sign-up form again.
  useEffect(() => {
    if (status === "authenticated") router.replace(next || "/dashboard");
  }, [status, router, next]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function onSubmit(values: Values) {
    // Better Auth is enumeration-safe on sign-up (H1): whether or not the email
    // already exists, we get a generic success and show the same notice.
    const { error } = await signUp.email({
      email: values.email,
      password: values.password,
      name: values.name,
      surname: values.surname,
      language: values.language,
      // Carried through to the verification email's redirect (H188): the API
      // decodes this back into `next` on /verify-email.
      ...(next ? { callbackURL: `/verify-email?verified=1&next=${encodeURIComponent(next)}` } : {}),
    });
    if (error && error.status !== 200) {
      form.setError("root", { message: error.message ?? t("couldNotCreateAccount") });
      return;
    }
    setSubmittedEmail(values.email);
  }

  if (submittedEmail) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <MailCheckIcon aria-hidden="true" className="size-6" />
          </div>
          <CardTitle>{t("checkInbox")}</CardTitle>
          <CardDescription>{t("verificationSent", { email: submittedEmail })}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-center text-sm">
          <p>{t("checkSpamFolder")}</p>
          <p>
            {t("didntGetIt")}{" "}
            <Link
              href={withReturnPath(
                `/verify-email?email=${encodeURIComponent(submittedEmail)}`,
                next || null,
              )}
              className="text-foreground underline underline-offset-4"
            >
              {t("resendVerification")}
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createYourAccount")}</CardTitle>
        <CardDescription>{t("signUpDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="given-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="surname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("surname")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="family-name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
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
                  <FormLabel>{t("password")}</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("language")}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {LANGS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {languageName(l)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              {t("createAccount")}
            </SubmitButton>
            <p className="text-muted-foreground text-pretty text-center text-xs leading-5">
              {t("signUpLegalPrefix")}{" "}
              <Link className="text-foreground underline underline-offset-4" href="/terms">
                {t("termsAndConditions").toLocaleLowerCase()}
              </Link>{" "}
              {t("signUpLegalJoin")}{" "}
              <Link className="text-foreground underline underline-offset-4" href="/privacy">
                {t("privacyPolicy").toLocaleLowerCase()}
              </Link>
              .
            </p>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        {t("alreadyHaveAccount")}{" "}
        <Link
          href={withReturnPath("/login", next || null)}
          className="text-foreground underline underline-offset-4"
        >
          {t("signIn")}
        </Link>
      </div>
    </Card>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpInner />
    </Suspense>
  );
}
