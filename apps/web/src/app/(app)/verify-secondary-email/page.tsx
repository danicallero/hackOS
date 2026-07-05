"use client";

import { CheckCircle2Icon, MailWarningIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";
import { useSessionContext } from "@/lib/session";

type State =
  | { status: "loading" }
  | { status: "ok"; already: boolean }
  | { status: "error"; message: string };

function VerifySecondaryInner() {
  const token = useSearchParams().get("token");
  const { refresh } = useSessionContext();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ status: "error", message: "This link is missing its token." });
      return;
    }
    api
      .post<{ status: true; alreadyVerified: boolean }>("/api/me/secondary-email/verify", { token })
      .then(async (r) => {
        await refresh();
        setState({ status: "ok", already: r.alreadyVerified });
      })
      .catch((err) =>
        setState({
          status: "error",
          message: err instanceof ApiError ? err.message : "Could not verify this link.",
        }),
      );
  }, [token, refresh]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm">
        {state.status === "loading" ? (
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <Spinner className="size-6" />
            <p className="text-muted-foreground text-sm">Verifying your secondary email…</p>
          </CardContent>
        ) : state.status === "ok" ? (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-success/10 text-success mb-2 grid size-12 place-items-center rounded-full">
                <CheckCircle2Icon className="size-6" />
              </div>
              <CardTitle>Secondary email verified</CardTitle>
              <CardDescription>
                {state.already
                  ? "This address was already verified."
                  : "We'll use it to match your Devpost projects on import."}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild>
                <Link href="/settings/profile">Back to profile</Link>
              </Button>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader className="items-center justify-items-center text-center">
              <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
                <MailWarningIcon className="size-6" />
              </div>
              <CardTitle>Couldn&apos;t verify</CardTitle>
              <CardDescription>{state.message}</CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild variant="outline">
                <Link href="/settings/profile">Back to profile</Link>
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

export default function VerifySecondaryEmailPage() {
  return (
    <Suspense>
      <VerifySecondaryInner />
    </Suspense>
  );
}
