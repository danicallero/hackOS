"use client";

import { AvailabilityEditor } from "@/app/(app)/help-desk/availability-editor";
import { MentorProfileEditor } from "@/components/profile/mentor-profile-editor";
import { useOwnHelperProfile } from "@/hooks/use-own-helper-profile";

/**
 * Mentoring in My profile (H61, H62): one publication switch for the mentor and
 * help desk profiles, the areas, challenge alerts and knowledge, and when the
 * mentor plans to be at the venue (each interval saves as it is added).
 */
export function MentoringSection({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const own = useOwnHelperProfile();
  return (
    <MentorProfileEditor
      onDirtyChange={onDirtyChange}
      extra={
        own.data?.eligible ? <AvailabilityEditor profile={own.data} onSaved={own.mutate} /> : null
      }
    />
  );
}
