"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
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
import { signIn } from "@/lib/auth-client";
import { useSessionContext } from "@/lib/session";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Required"),
});

type Values = z.infer<typeof schema>;

/** Only allow same-origin relative paths as a post-login destination — never
 * an absolute URL or protocol-relative `//host` (open-redirect guard). */
function safeNext(next: string | null): string {
  if (next?.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

function LoginInner() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const { status, refresh } = useSessionContext();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  // Already signed in: bounce straight to the destination instead of showing
  // the form again — /login isn't admin-only, any signed-in user lands here.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-6" />
      </div>
    );
  }

  async function onSubmit(values: Values) {
    const { error } = await signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      const message =
        error.code === "INVALID_EMAIL_OR_PASSWORD" || error.status === 401
          ? "Incorrect email or password."
          : (error.message ?? "Could not sign in. Please try again.");
      form.setError("root", { message });
      return;
    }
    await refresh();
    // M1.1: honour ?next (e.g. an invited participant sent to /my-applications).
    router.push(next);
  }

  const emailValue = form.watch("email");
  const forgotHref = emailValue
    ? `/forgot-password?email=${encodeURIComponent(emailValue)}`
    : "/forgot-password";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to your hackOS account.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
              </Alert>
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
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
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href={forgotHref}
                      className="text-muted-foreground text-xs underline underline-offset-4"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SubmitButton className="w-full" pending={form.formState.isSubmitting}>
              Sign in
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        New to hackOS?{" "}
        <Link href="/signup" className="text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
