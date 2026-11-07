"use client";

import { PERMISSIONS_RESOURCES } from "@/lib/permissions-resources";
import { rolesApi } from "@/lib/roles-api";
import type { RoleSummary } from "@/lib/types";
import { useServerResource } from "./use-server-resource";

/**
 * Role list shared through the permissions server-state key. A failed read
 * surfaces as `error` (roles stays empty), never as an empty list that looks
 * like "no roles exist".
 */
export function useRoles({ enabled = true }: { enabled?: boolean } = {}): {
  roles: RoleSummary[];
  error: unknown;
  reload: () => void;
} {
  const { data, error, reload } = useServerResource(
    PERMISSIONS_RESOURCES.roles,
    (signal) => rolesApi.list(signal),
    { enabled },
  );
  return { roles: data ?? [], error, reload };
}
