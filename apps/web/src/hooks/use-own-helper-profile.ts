"use client";
import type { MyHelperProfile } from "@/app/(app)/help-desk/model";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";

/**
 * The caller's own helper profile (H61). Every reader shares the key, so a
 * save in My profile updates the public profile form and help desk navigation.
 */
export function useOwnHelperProfile() {
  return useServerResource(["helpdesk", "own-profile"], (signal) =>
    api.get<MyHelperProfile>("/api/me/helper-profile", { signal }),
  );
}
