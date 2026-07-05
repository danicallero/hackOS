"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, MailIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SubmitButton } from "@/components/common/submit-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { ApiError, api } from "@/lib/api";

const schema = z.object({ email: z.string().email("Enter a valid email") });
type Values = z.infer<typeof schema>;

/** Maps Better Auth's verify-email error codes to friendly copy (H2). */
function messageForError(error: string | null): { title: string; body: string } | null {
  if (!error) return null;
  if (error === "token_expired" || error === "TOKEN_EXPIRED")
    return {
      title: "This link has expired",
      body: "Verification links are short-lived. Request a fresh one below.",
    };
  if (error === "invalid_token" || error === "INVALID_TOKEN")
    return {
      title: "This link is no longer valid",
      body: "If you've already verified, just sign in — you're all set.",
    };
  return { title: "We couldn't verify that link", body: "Request a new verification email below." };
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const verified = params.get("verified") !== null || params.get("status") === "verified";
  const errorInfo = messageForError(params.get("error"));
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: params.get("email") ?? "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function onSubmit(values: Values) {
    try {
      await api.post("/api/auth/resend-verification", { email: values.email });
      toast.success("Verification email sent. Check your inbox.");
      setCooldown(60); // H3: 60s between attempts
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setCooldown(err.retryAfter ?? 60);
        form.setError("root", { message: err.message });
        return;
      }
      form.setError("root", {
        message: err instanceof ApiError ? err.message : "Could not send the email.",
      });
    }
  }

  if (verified) {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
            <CheckCircle2Icon className="size-6" />
          </div>
          <CardTitle>Email verified</CardTitle>
          <CardDescription>Your address is confirmed. You can sign in now.</CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/login" className="text-sm underline underline-offset-4">
            Continue to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
          <MailIcon className="size-6" />
        </div>
        <CardTitle>Verify your email</CardTitle>
        <CardDescription>
          Follow the link we emailed you. Didn&apos;t get it? Resend below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorInfo && (
          <Alert variant="destructive">
            <AlertTitle>{errorInfo.title}</AlertTitle>
            <AlertDescription>{errorInfo.body}</AlertDescription>
          </Alert>
        )}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            {form.formState.errors.root && (
              <p className="text-destructive text-sm">{form.formState.errors.root.message}</p>
            )}
            <SubmitButton
              className="w-full"
              pending={form.formState.isSubmitting}
              disabled={cooldown > 0}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
            </SubmitButton>
          </form>
        </Form>
      </CardContent>
      <div className="text-muted-foreground px-6 pb-6 text-center text-sm">
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
