"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  APP_HOME_PATH,
  hasPendingOnboarding,
  ONBOARDING_PATH,
  readOnboarding,
  wasOnboardingOffered,
} from "@/lib/onboarding";
import { useSessionContext } from "@/lib/session";

/**
 * Offers the onboarding journey once per browser session, only when the person
 * lands on the app home. It is a redirect, never a gate: every other route
 * renders immediately, a failed read is ignored, and /onboarding stays
 * reachable (My profile, the completion step) whenever steps are still open.
 */
export function OnboardingEntry({ children }: { children: React.ReactNode }) {
  const { me } = useSessionContext();
  const pathname = usePathname();
  const router = useRouter();
  const eligible = Boolean(me?.hasEventAccess && me.emailVerified);
  const userId = me?.id ?? null;

  useEffect(() => {
    if (!eligible || userId === null || pathname !== APP_HOME_PATH || wasOnboardingOffered(userId))
      return;
    const controller = new AbortController();
    readOnboarding(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted && hasPendingOnboarding(state))
          router.replace(ONBOARDING_PATH);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eligible, userId, pathname, router]);

  return children;
}
