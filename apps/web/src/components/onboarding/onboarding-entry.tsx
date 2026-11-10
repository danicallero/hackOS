"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  forPerson,
  hasPendingOnboarding,
  markOnboardingOffered,
  ONBOARDING_PATH,
  readOnboarding,
  wasOnboardingOffered,
} from "@/lib/onboarding";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

/**
 * Offers the onboarding journey on the first page of each sign-in session,
 * wherever the person lands (the page they came for is carried as `next`, so
 * Later returns there). It is a redirect, never a gate: pages render
 * immediately, a failed read is ignored, and /onboarding stays reachable
 * (My profile, the completion step) whenever steps are still open.
 */
export function OnboardingEntry({ children }: { children: React.ReactNode }) {
  const { me } = useSessionContext();
  const profileLocked = Boolean(me?.profileLocked);
  const dietaryLocked = Boolean(me?.dietaryLocked);
  const pathname = usePathname();
  const router = useRouter();
  const eligible = Boolean(me?.hasEventAccess && me.emailVerified);
  const here = pathname + (typeof window === "undefined" ? "" : window.location.search);
  const userId = me?.id ?? null;

  useEffect(() => {
    if (
      !eligible ||
      userId === null ||
      pathname.startsWith(ONBOARDING_PATH) ||
      wasOnboardingOffered(userId)
    )
      return;
    const controller = new AbortController();
    readOnboarding(controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) markOnboardingOffered(userId);
        if (
          !controller.signal.aborted &&
          hasPendingOnboarding(forPerson(state, { profileLocked, dietaryLocked }))
        )
          router.replace(withReturnPath(ONBOARDING_PATH, here));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [eligible, userId, pathname, here, router, profileLocked, dietaryLocked]);

  return children;
}
