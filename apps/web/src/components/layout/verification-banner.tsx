"use client";

import { MailWarningIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/session";

/**
 * H1: an unverified account can sign in but can't do anything transactional.
 * We surface that state persistently until they verify, with a shortcut to the
 * resend flow.
 */
export function VerificationBanner() {
  const me = useMe();
  if (!me || me.emailVerified) return null;

  return (
    <div className="border-warning/40 bg-warning/10 text-warning-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6">
      <MailWarningIcon className="text-warning size-4 shrink-0" />
      <span className="text-foreground">
        Your email isn&apos;t verified yet. Verify it to unlock registration and confirmations.
      </span>
      <Button asChild size="sm" variant="outline" className="ml-auto h-7">
        <Link href={`/verify-email?email=${encodeURIComponent(me.email)}`}>Verify now</Link>
      </Button>
    </div>
  );
}
