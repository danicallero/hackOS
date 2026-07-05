"use client";

// Public spot-decline landing page (H15). The acceptance email links here with
// ?token=… (service.ts builds ${WEB_URL}/applications/decline?token=…) so an
// applicant who can't make it frees their spot in one click — no sign-in
// required. Declining wipes any dietary data unless another confirmed spot
// still needs it (H12). A second click is idempotent (already_declined).

import { CalendarXIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api } from "@/lib/api";

interface DeclineResult {
  status: string;
  already_declined: boolean;
  sensitive_wiped: boolean;
}

function DeclineInner() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [result, setResult] = useState<DeclineResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setErrorMsg("This link is missing its token.");
      setState("error");
      return;
    }
    api
      .post<DeclineResult>("/api/applications/decline", { token })
      .then((res) => {
        setResult(res);
        setState("done");
      })
      .catch((err) => {
        setErrorMsg(
          err instanceof ApiError ? err.message : "We couldn't release your spot from this link.",
        );
        setState("error");
      });
  }, [token]);

  if (state === "loading") {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner className="size-6" />
          <p className="text-muted-foreground text-sm">Releasing your spot…</p>
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card>
        <CardHeader className="items-center justify-items-center text-center">
          <div className="bg-destructive/10 text-destructive mb-2 grid size-12 place-items-center rounded-full">
            <TriangleAlertIcon className="size-6" />
          </div>
          <CardTitle>We couldn&apos;t process this link</CardTitle>
          <CardDescription>{errorMsg}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-center">
          <Button asChild variant="outline">
            <Link href="/my-applications">Go to my applications</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const alreadyDone = result?.already_declined;
  return (
    <Card>
      <CardHeader className="items-center justify-items-center text-center">
        <div className="bg-muted text-muted-foreground mb-2 grid size-12 place-items-center rounded-full">
          <CalendarXIcon className="size-6" />
        </div>
        <CardTitle>{alreadyDone ? "Your spot was already released" : "Spot released"}</CardTitle>
        <CardDescription>
          {alreadyDone
            ? "You'd already declined this place — nothing else to do."
            : "Thanks for letting us know. We've released your spot so someone else can take it."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-center">
        <p className="text-muted-foreground text-sm">
          Changed your mind? Contact the organizers — if the window is still open they may be able
          to reinstate you.
        </p>
        <Button asChild variant="outline">
          <Link href="/my-applications">View my applications</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DeclineSpotPage() {
  return (
    <Suspense>
      <DeclineInner />
    </Suspense>
  );
}
