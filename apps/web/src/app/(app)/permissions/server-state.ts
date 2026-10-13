import { invalidateServerState } from "@/lib/server-state";

export const PERMISSIONS_RESOURCES = {
  roles: ["permissions", "roles"],
  templates: ["permissions", "role-templates"],
  users: ["permissions", "users", 200],
} as const;

export function invalidatePermissionsResources() {
  for (const key of Object.values(PERMISSIONS_RESOURCES)) invalidateServerState(key);
}
