"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MultiSelect } from "@/components/common/multi-select";
import { PasswordInput } from "@/components/common/password-input";
import { Spinner } from "@/components/common/spinner";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { languageName, pickText, type Translate, useLocale } from "@/lib/i18n";
import { destinationForKind } from "@/lib/invite-destination";
import { withReturnPath } from "@/lib/return-path";
import type { Intolerance, InviteKind, Language } from "@/lib/types";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

function claimSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("required")).max(200),
    surname: z.string().min(1, t("required")).max(200),
    password: z.string().min(8, t("atLeastEight")),
    phone: z.string().max(50),
    language: z.enum(["en", "es", "gl"]),
    shirtSize: z.string(),
    foodIntolerances: z.array(z.string()),
    // Optional free-text dietary notes (M1.3). Optional here and everywhere else.
    foodIntoleranceNotes: z.string().max(2000),
  });
}
type Values = z.infer<ReturnType<typeof claimSchema>>;
const NONE = "__none__";

function ClaimInner() {
  const { t } = useLocale();
  const schema = useMemo(() => claimSchema(t), [t]);
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [lookup, setLookup] = useState<
    { email: string; kind: InviteKind; expired?: boolean } | null | "error"
  >(null);
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [done, setDone] = useState(false);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      surname: "",
      password: "",
      phone: "",
      language: "es",
      shirtSize: NONE,
      foodIntolerances: [],
      foodIntoleranceNotes: "",
    },
  });

  useEffect(() => {
    if (!token) {
      setLookup("error");
      return;
    }
    api
      .get<{ email: string; kind: InviteKind; expired?: boolean }>("/api/invites/lookup", {
        query: { token },
      })
      .then(setLookup)
      .catch(() => setLookup("error"));
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, [token]);

  async function onSubmit(values: Values) {
    if (!token) return;
    const kind = lookup && lookup !== "error" ? lookup.kind : "staff";
    if (kind === "participant" && values.shirtSize === NONE) {
      form.setError("shirtSize", { message: t("shirtSizeRequiredDesc") });
      return;
    }
    try {
      await api.post("/api/invites/accept", {
        token,
        name: values.name,
        surname: values.surname,
        password: values.password,
        ...(values.phone ? { phone: values.phone } : {}),
        language: values.language,
        ...(values.shirtSize !== NONE ? { shirtSize: values.shirtSize } : {}),
        foodIntolerances: values.foodIntolerances.map(Number),
        ...(values.foodIntoleranceNotes.trim()
          ? { foodIntoleranceNotes: values.foodIntoleranceNotes.trim() }
          : {}),
      });
      setDone(true);
    } catch (err) {
      form.setError("root", {
        message: err instanceof ApiError ? err.message : t("couldNotCreateAccount"),
      });
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
          <CardTitle>{t("inviteUnavailable")}</CardTitle>
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
            <CheckCircle2Icon aria-hidden="true" className="size-6" />
          </div>
          <CardTitle>{t("accountCreated")}</CardTitle>
        </CardHeader>
        <CardContent className="text-center">
          <SubmitButton
            onClick={() =>
              // H9/H10/H188: every invitation kind lands somewhere specific
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
    label: pickText(i.label, form.watch("language") as Language),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("createYourAccount")}</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                      <Input {...field} />
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
              name="language"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("language")}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
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
            {lookup.kind !== "sponsor" && (
              <FormField
                control={form.control}
                name="shirtSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("shirtSize")}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("notSet")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>{t("notSet")}</SelectItem>
                        {SHIRT_SIZES.map((s) => (
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
            <FormField
              control={form.control}
              name="foodIntolerances"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("foodIntolerances")}</FormLabel>
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
                  <p className="text-muted-foreground text-xs">{t("dietaryDataHandlingNote")}</p>
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
