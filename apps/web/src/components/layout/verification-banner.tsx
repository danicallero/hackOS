"use client";

import { MailWarningIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";
import { withReturnPath } from "@/lib/return-path";
import { useMe } from "@/lib/session";

/**
 * H1: an unverified account can sign in but can't do anything transactional.
 * We surface that state persistently until they verify, with a shortcut to the
 * resend flow. The current page is carried through as `next` (H188) so
 * resending from wherever the user got stuck brings them right back there.
 */
export function VerificationBanner() {
  const me = useMe();
  const { t } = useLocale();
  const pathname = usePathname();
  if (!me || me.emailVerified) return null;

  const verifyHref = withReturnPath(
    `/verify-email?email=${encodeURIComponent(me.email)}`,
    pathname,
  );

  return (
    <div className="border-warning/40 bg-warning/10 text-warning-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6">
      <MailWarningIcon className="text-warning size-4 shrink-0" />
      <span className="text-foreground">{t("emailNotVerified")}</span>
      <Button asChild size="sm" variant="outline" className="ml-auto h-7">
        <Link href={verifyHref}>{t("verifyNow")}</Link>
      </Button>
    </div>
  );
}
