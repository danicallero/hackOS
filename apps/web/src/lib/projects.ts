import { api } from "./api";
import type { NativeProject } from "./native-projects";

/** H21: capability-scoped projects shown on a person’s record. */
export type RepoWithExtras = NativeProject;
export const userProjects = (userId: number) =>
  api.get<{ projects: NativeProject[] }>(`/api/users/${userId}/projects`);
