"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ContextualError } from "@/components/common/contextual-error";
import { MultiSelect } from "@/components/common/multi-select";
import { PasswordInput } from "@/components/common/password-input";
import { Spinner } from "@/components/common/spinner";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useShirtSizes } from "@/hooks/use-shirt-sizes";
import { ApiError, api } from "@/lib/api";
import { signIn } from "@/lib/auth-client";
import { languageName, pickText, type Translate, useLocale } from "@/lib/i18n";
import { destinationForKind } from "@/lib/invite-destination";
import { resetNetworkingOnboardingDeferrals } from "@/lib/networking-onboarding";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";
import type { InviteLookup, Language } from "@/lib/types";

function claimSchema(t: Translate) {
  return z
    .object({
      email: z.string().email(t("validEmail")).or(z.literal("")),
      name: z.string().min(1, t("required")).max(200),
      surname: z.string().min(1, t("required")).max(200),
      password: z.string().min(8, t("atLeastEight")),
      confirmPassword: z.string(),
      language: z.enum(["en", "es", "gl"]),
      shirtSize: z.string(),
      foodIntolerances: z.array(z.string()),
      // Optional free-text dietary notes (M1.3). Optional here and everywhere else.
      foodIntoleranceNotes: z.string().max(2000),
    })
    .refine((values) => values.password === values.confirmPassword, {
      message: t("passwordsDontMatch"),
      path: ["confirmPassword"],
    });
}
type Values = z.infer<ReturnType<typeof claimSchema>>;
const NONE = "__none__";

function detailsField(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) return undefined;
  const field = (details as { field?: unknown }).field;
  return typeof field === "string" ? field : undefined;
}

/** Keep API details in diagnostics while preserving H9/H10 recovery copy. */
function localizedClaimError(error: ApiError, t: Translate): string {
  const code = error.code.toUpperCase();
  console.error("[auth:claim-account] request failed", {
    code,
    status: error.status,
    error,
  });

  if (code === "BAD_REQUEST" && detailsField(error.details) === "shirtSize") {
    return t("shirtSizeRequiredDesc");
  }
  if (code === "NOT_FOUND" || code === "CONFLICT" || error.status === 404 || error.status === 409) {
    return t("inviteUnavailable");
  }
  return t("couldNotCreateAccount");
}

function ClaimInner() {
  const { t, language, setLanguage } = useLocale();
  const schema = useMemo(() => claimSchema(t), [t]);
  const token = useSearchParams().get("token");
  const router = useRouter();
  const { refresh } = useSessionContext();
  const [lookup, setLookup] = useState<InviteLookup | null | "error">(null);
  const [done, setDone] = useState(false);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) confirmationHeading.current?.focus();
  }, [done]);
  const { sizes: shirtSizes, error: shirtSizesError, reload: reloadShirtSizes } = useShirtSizes();
  const { intolerances, error: dictionaryError, reload: reloadDictionary } = useFoodIntolerances();

  const form = useForm<Values>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      name: "",
      surname: "",
      password: "",
      confirmPassword: "",
      language,
      shirtSize: NONE,
      foodIntolerances: [],
      foodIntoleranceNotes: "",
    },
  });

  const { setValue } = form;
  useEffect(() => {
    // H7/H10: the account preference follows language changes during onboarding.
    setValue("language", language);
  }, [language, setValue]);

  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- No token to look up; same external-system-sync effect as the fetches below.
      setLookup("error");
      return;
    }
    api
      .get<InviteLookup>("/api/invites/lookup", {
        query: { token },
      })
      .then(setLookup)
      .catch(() => setLookup("error"));
  }, [token]);

  async function onSubmit(values: Values) {
    if (!token) return;
    if (lookup !== null && lookup !== "error" && lookup.reusable && !values.email?.trim()) {
      form.setError("email", { message: t("validEmail") });
      return;
    }
    const requireShirtSize = lookup !== null && lookup !== "error" && lookup.requireShirtSize;
    if (requireShirtSize && values.shirtSize === NONE) {
      form.setError("shirtSize", { message: t("shirtSizeRequiredDesc") });
      return;
    }
    try {
      const account = await api.post<{ email: string }>("/api/invites/accept", {
        token,
        ...(lookup !== null && lookup !== "error" && lookup.reusable
          ? { email: values.email?.trim().toLowerCase() }
          : {}),
        name: values.name,
        surname: values.surname,
        password: values.password,
        language,
        ...(values.shirtSize !== NONE ? { shirtSize: values.shirtSize } : {}),
        foodIntolerances: values.foodIntolerances.map(Number),
        ...(values.foodIntoleranceNotes.trim()
          ? { foodIntoleranceNotes: values.foodIntoleranceNotes.trim() }
          : {}),
      });
      // H10: the new account enters its profile step in the same flow.
      try {
        const result = await signIn.email({ email: account.email, password: values.password });
        if (!result.error) {
          resetNetworkingOnboardingDeferrals();
          await refresh();
          router.push(
            destinationForKind(lookup && lookup !== "error" ? lookup.kind : "participant"),
          );
          return;
        }
      } catch {
        /* Account creation succeeded; offer sign-in recovery below. */
      }
      setDone(true);
    } catch (err) {
      form.setError("root", {
        message: err instanceof ApiError ? localizedClaimError(err, t) : t("couldNotCreateAccount"),
      });
      if (!(err instanceof ApiError)) console.error("[auth:claim-account] request failed", err);
    }
  }

  if (lookup === null) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-10">
          <Spinner className="size-6" />
        </CardContent>
      </Card>
    );
  }

  if (lookup === "error" || lookup.expired) {
    return (
      <Card>
        <CardHeader>
          <h1 className="type-section-title text-balance">{t("inviteUnavailable")}</h1>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline underline-offset-4">
            {t("signIn")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircleIcon aria-hidden="true" className="size-6" />
          </div>
          <h1 ref={confirmationHeading} tabIndex={-1} className="type-section-title text-balance">
            {t("accountCreated")}
          </h1>
        </CardHeader>
        <CardContent className="text-center">
          <SubmitButton
            onClick={() =>
              // H9/H10/#188: every invitation kind lands somewhere specific
              // after signing in — login honours the `next` param.
              router.push(withReturnPath("/login", destinationForKind(lookup.kind)))
            }
          >
            {t("signIn")}
          </SubmitButton>
        </CardContent>
      </Card>
    );
  }

  const intoleranceOptions = intolerances.map((i) => ({
    value: String(i.id),
    label: pickText(i.label, language),
  }));
  const inviteRole =
    lookup.kind === "staff"
      ? t("roleStaff")
      : lookup.kind === "sponsor"
        ? t("roleSponsor")
        : t("roleParticipant");

  return (
    <Card>
      <CardHeader>
        <h1 className="type-section-title text-balance">{t("createYourAccount")}</h1>
        {lookup.reusable && (
          <p className="text-muted-foreground text-pretty text-sm">
            {t("reusableInviteRole", { role: inviteRole })}
          </p>
        )}
        {lookup.reusable && lookup.enterpriseName && (
          <p className="text-muted-foreground text-pretty text-sm">
            {t("enterpriseInviteJoin", { enterprise: lookup.enterpriseName })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            {lookup.reusable && (
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("email")}</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <p className="text-muted-foreground text-xs">
                      {t("enterpriseInviteEmailNote")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
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
            <FormField
              control={form.control}
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("language")}</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      setLanguage(value as Language);
                    }}
                    value={language}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(["es", "gl", "en"] as Language[]).map((language) => (
                        <SelectItem key={language} value={language}>
                          {languageName(language)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {lookup.requireShirtSize && (
              <FormField
                control={form.control}
                name="shirtSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("shirtSize")}</FormLabel>
                    {shirtSizesError ? (
                      <ContextualError
                        message={t("couldNotLoadDictionary")}
                        onRetry={reloadShirtSizes}
                      />
                    ) : null}
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("notSet")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                        {shirtSizes.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            {lookup.requireDietary && (
              <>
                <FormField
                  control={form.control}
                  name="foodIntolerances"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("foodIntolerances")}</FormLabel>
                      {dictionaryError ? (
                        <ContextualError
                          message={t("couldNotLoadDictionary")}
                          onRetry={reloadDictionary}
                        />
                      ) : null}
                      <FormControl>
                        <MultiSelect
                          options={intoleranceOptions}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t("selectIntolerances")}
                          searchPlaceholder={t("searchIntolerances")}
                          emptyText={t("noIntolerances")}
                        />
                      </FormControl>
                      <p className="text-muted-foreground text-xs">
                        {t("dietaryDataHandlingNote")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="foodIntoleranceNotes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("otherDietaryNotes")}</FormLabel>
                      <FormControl>
                        <Textarea rows={3} placeholder={t("cateringNotes")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              {t("createAccount")}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function ClaimAccountPage() {
  return (
    <Suspense>
      <ClaimInner />
    </Suspense>
  );
}
