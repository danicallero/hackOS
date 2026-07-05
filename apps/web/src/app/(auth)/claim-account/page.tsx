"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { MultiSelect } from "@/components/common/multi-select";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/api";
import { pickText } from "@/lib/i18n";
import type { Intolerance, InviteKind, Language } from "@/lib/types";

const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL"] as const;

const schema = z.object({
  name: z.string().min(1, "Required").max(200),
  surname: z.string().min(1, "Required").max(200),
  password: z.string().min(8, "At least 8 characters"),
  phone: z.string().max(50),
  language: z.enum(["en", "es", "gl"]),
  shirtSize: z.string(),
  foodIntolerances: z.array(z.string()),
  // Optional free-text dietary notes (M1.3). Optional here and everywhere else.
  foodIntoleranceNotes: z.string().max(2000),
});
type Values = z.infer<typeof schema>;
const NONE = "__none__";

function ClaimInner() {
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
      form.setError("shirtSize", { message: "Participants must choose a shirt size" });
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
        message: err instanceof ApiError ? err.message : "Could not create your account.",
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
          <CardTitle>Invite unavailable</CardTitle>
          <CardDescription>
            This invitation link is invalid, already used or expired. Ask the organization to send a
            new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Go to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  const invitedAsParticipant = lookup.kind === "participant";

  if (done) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircle2Icon className="size-6" />
          </div>
          <CardTitle>Account created</CardTitle>
          <CardDescription>
            {invitedAsParticipant
              ? "Sign in and we'll take you straight to your application."
              : "You can sign in now with your email and password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <SubmitButton
            onClick={() =>
              // M1.1: an invited participant lands directly on the application
              // form after signing in (login honours the `next` param).
              router.push(
                invitedAsParticipant
                  ? `/login?next=${encodeURIComponent("/my-applications")}`
                  : "/login",
              )
            }
          >
            Continue to sign in
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
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          You were invited as <strong>{lookup.kind}</strong> — <span>{lookup.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
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
                    <FormLabel>Surname</FormLabel>
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
                  <FormLabel>Password</FormLabel>
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
                  <FormLabel>Language</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="es">Castellano</SelectItem>
                      <SelectItem value="gl">Galego</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="shirtSize"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Shirt size{invitedAsParticipant ? "" : " (optional)"}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Not set" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Not set</SelectItem>
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
            <FormField
              control={form.control}
              name="foodIntolerances"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Food intolerances</FormLabel>
                  <FormControl>
                    <MultiSelect
                      options={intoleranceOptions}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select any that apply…"
                      searchPlaceholder="Search…"
                      emptyText="None in the catalogue yet."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="foodIntoleranceNotes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dietary notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      placeholder="Anything else the kitchen should know (allergies severity, preferences…)"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              Create account
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
