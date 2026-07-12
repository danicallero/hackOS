"use client";

import { MailWarningIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { useMe } from "@/lib/session";

/**
 * H1: an unverified account can sign in but can't do anything transactional.
 * We surface that state persistently until they verify, with a shortcut to the
 * resend flow.
 */
export function VerificationBanner() {
  const me = useMe();
  const { t } = useLocale();
  if (!me || me.emailVerified) return null;

  return (
    <div className="border-warning/40 bg-warning/10 text-warning-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6">
      <MailWarningIcon className="text-warning size-4 shrink-0" />
      <span className="text-foreground">{t("emailNotVerified")}</span>
      <Button asChild size="sm" variant="outline" className="ml-auto h-7">
        <Link href={`/verify-email?email=${encodeURIComponent(me.email)}`}>{t("verifyNow")}</Link>
      </Button>
    </div>
  );
}
