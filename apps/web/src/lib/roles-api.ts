import { api } from "@/lib/api";
import { invalidatePermissionsResources } from "@/lib/permissions-resources";
import type { PermissionState, RoleDetail, RoleSeedDiff, RoleSummary } from "@/lib/types";

async function mutated<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  invalidatePermissionsResources();
  return result;
}

/**
 * `/api/roles`. Every mutation drops the cached permissions resources itself,
 * so a caller cannot forget to (stale roster/role lists otherwise).
 */
export const rolesApi = {
  list: (signal?: AbortSignal) => api.get<RoleSummary[]>("/api/roles", { signal }),
  listWithDeleted: () => api.get<RoleSummary[]>("/api/roles", { query: { includeDeleted: true } }),
  get: (roleId: number) => api.get<RoleDetail>(`/api/roles/${roleId}`),
  seedDiff: (roleId: number) => api.get<RoleSeedDiff>(`/api/roles/${roleId}/seed-diff`),
  create: (body: {
    name: string;
    position: number;
    isVisible: boolean;
    eventAccess: boolean;
    templateKey?: string;
  }) => mutated(api.post<RoleDetail>("/api/roles", body)),
  update: (roleId: number, body: { name: string; isVisible: boolean; eventAccess: boolean }) =>
    mutated(api.patch<RoleDetail>(`/api/roles/${roleId}`, body)),
  move: (roleId: number, position: number) =>
    mutated(api.patch<RoleDetail>(`/api/roles/${roleId}/position`, { position })),
  setCapabilities: (
    roleId: number,
    capabilities: { capability: string; state: PermissionState }[],
  ) => mutated(api.put<RoleDetail>(`/api/roles/${roleId}/capabilities`, { capabilities })),
  addMember: (roleId: number, userId: number) =>
    mutated(api.post<RoleDetail>(`/api/roles/${roleId}/users/${userId}`, {})),
  removeMember: (roleId: number, userId: number) =>
    mutated(api.delete<RoleDetail>(`/api/roles/${roleId}/users/${userId}`)),
  reset: (roleId: number) =>
    mutated(api.post<RoleDetail>(`/api/roles/${roleId}/reset-to-default`, {})),
  restore: (roleId: number) => mutated(api.post<RoleDetail>(`/api/roles/${roleId}/restore`, {})),
  remove: (roleId: number) => mutated(api.delete<{ deleted: true }>(`/api/roles/${roleId}`)),
};
