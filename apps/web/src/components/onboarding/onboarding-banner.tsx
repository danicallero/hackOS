"use client";

import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useServerResource } from "@/hooks/use-server-resource";
import { useLocale } from "@/lib/i18n";
import { forPerson, ONBOARDING_PATH, openSteps, readOnboarding } from "@/lib/onboarding";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

/**
 * Stays in the app while the onboarding journey still has steps to answer
 * (pending, or put off with Later), so leaving it never loses the way back.
 * Nothing is shown once everything is answered, skipped or declined.
 */
export function OnboardingBanner() {
  const { me } = useSessionContext();
  const { t } = useLocale();
  const pathname = usePathname();
  const eligible =
    Boolean(me?.hasEventAccess && me.emailVerified) && !pathname.startsWith(ONBOARDING_PATH);
  const state = useServerResource(["me", "onboarding"], (signal) => readOnboarding(signal), {
    enabled: eligible,
  });
  if (!eligible || !me || !state.data) return null;
  if (openSteps(forPerson(state.data, me)).length === 0) return null;
  return (
    <div className="border-primary/30 bg-primary/10 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm sm:px-6">
      <ListChecksIcon aria-hidden="true" className="text-primary size-4 shrink-0" />
      <span className="text-foreground">{t("onboardingBanner")}</span>
      <Button asChild size="sm" variant="outline">
        <Link href={withReturnPath(ONBOARDING_PATH, pathname)}>{t("onboardingContinue")}</Link>
      </Button>
    </div>
  );
}
