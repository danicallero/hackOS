"use client";

import { useMemo } from "react";
import { useServerResource } from "@/hooks/use-server-resource";
import { api } from "@/lib/api";

export interface AudienceRole {
  id: number;
  name: string;
}

/**
 * The publicly visible roles a schedule item can be addressed to (H59), for the
 * audience picker and to name `role:<id>` audiences. People without schedule
 * access get no list, so those audiences read as a generic "Roles".
 */
export function useAudienceRoles() {
  const resource = useServerResource(["schedule", "audience-roles"], (signal) =>
    api.get<AudienceRole[]>("/api/schedule/audience-roles", { signal }),
  );
  const roles = Array.isArray(resource.data) ? resource.data : [];
  const names = useMemo(() => new Map(roles.map((role) => [role.id, role.name])), [roles]);
  return { roles, names };
}
