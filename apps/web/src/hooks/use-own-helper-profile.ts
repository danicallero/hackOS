"use client";
import type { MyHelperProfile } from "@/app/(app)/help-desk/model";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";

/**
 * A person's helper profile (H61): the caller's own, or, for user management,
 * another person's (`subjectId`). Every reader of the same person shares the
 * key, so a save in My profile updates the public profile form and help desk
 * navigation.
 */
export function useHelperProfileOf(subjectId?: number) {
  return useServerResource(
    subjectId === undefined ? ["helpdesk", "own-profile"] : ["helpdesk", "profile-of", subjectId],
    (signal) =>
      api.get<MyHelperProfile>(
        subjectId === undefined
          ? "/api/me/helper-profile"
          : `/api/users/${subjectId}/helper-profile`,
        { signal },
      ),
  );
}

/** The caller's own helper profile (H61). */
export const useOwnHelperProfile = () => useHelperProfileOf();
