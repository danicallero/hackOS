"use client";

import { AvailabilityEditor } from "@/app/(app)/help-desk/availability-editor";
import { MentorProfileEditor } from "@/components/profile/mentor-profile-editor";
import { useHelperProfileOf } from "@/hooks/use-own-helper-profile";
import { useLocale } from "@/lib/i18n";

/**
 * User management: the person's mentoring (mentor and help desk profile, areas,
 * challenge alerts and venue plan), edited for them. Staff can change and
 * unpublish but never publish: that stays the person's own consent.
 */
export function StaffMentoring({ userId }: { userId: number }) {
  const { t } = useLocale();
  const helper = useHelperProfileOf(userId);
  if (!helper.data?.eligible) return null;
  return (
    <section aria-labelledby="staff-mentoring" className="max-w-4xl space-y-4 border-t pt-8">
      <h2 id="staff-mentoring" className="type-section-title">
        {t("profileMentoringTitle")}
      </h2>
      <MentorProfileEditor
        subjectId={userId}
        extra={
          <AvailabilityEditor
            profile={helper.data}
            onSaved={helper.mutate}
            path={`/api/users/${userId}/helper-profile/availability`}
          />
        }
      />
    </section>
  );
}
