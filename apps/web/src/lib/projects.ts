import { api } from "./api";
import type { NativeProject } from "./native-projects";

/** H21: capability-scoped projects shown on a person’s record. */
export type RepoWithExtras = NativeProject;
export const userProjects = (userId: number, signal?: AbortSignal) =>
  api.get<{ projects: NativeProject[] }>(`/api/users/${userId}/projects`, { signal });
