"use client";

import { MailWarningIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useVerificationResend } from "@/hooks/use-verification-resend";
import { useLocale } from "@/lib/i18n";
import { useMe } from "@/lib/session";

/**
 * H1: an unverified account can sign in but can't do anything transactional.
 * We surface that state persistently until they verify, with an in-place resend
 * action. The current page is carried through as `next` (H188) so verification
 * brings them right back where they were interrupted.
 */
export function VerificationBanner() {
  const me = useMe();
  const { t } = useLocale();
  const pathname = usePathname();
  const { cooldown, resend, resending } = useVerificationResend(
    me?.email ?? "",
    `/verify-email?verified=1&next=${encodeURIComponent(pathname)}`,
  );
  if (!me || me.emailVerified) return null;

  return (
    <div className="border-warning/40 bg-warning/10 text-warning-foreground flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6">
      <MailWarningIcon className="text-warning size-4 shrink-0" />
      <span className="text-foreground">{t("emailNotVerified")}</span>
      <Button
        size="sm"
        variant="outline"
        className="border-warning/50 bg-warning/20 text-warning-foreground hover:bg-warning/30 hover:text-warning-foreground"
        disabled={cooldown > 0 || resending}
        onClick={() => void resend()}
      >
        {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("verifyNow")}
      </Button>
    </div>
  );
}
