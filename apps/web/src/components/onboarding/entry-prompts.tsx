"use client";

import { usePathname } from "next/navigation";
import { NotificationOnboardingDialog } from "@/components/layout/notification-onboarding-dialog";
import { ProfileTasksDialog } from "@/components/layout/profile-tasks-dialog";
import { ONBOARDING_PATH } from "@/lib/onboarding";

/**
 * The next-entry prompts (dietary, meal plan, notifications) for people who left
 * the journey unfinished. They stay out of /onboarding itself, whose steps ask
 * the same questions.
 */
export function EntryPrompts() {
  if (usePathname() === ONBOARDING_PATH) return null;
  return (
    <>
      <ProfileTasksDialog />
      <NotificationOnboardingDialog />
    </>
  );
}
