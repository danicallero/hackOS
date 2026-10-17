import type { FormSection, TemplateField } from "@/app/(app)/applications/lib";
import { api } from "./api";

/** H16–H21: one native project and the applications form contract. */
export interface NativeProject {
  id: number;
  canEdit: boolean;
  canSubmit?: boolean;
  canInvite?: boolean;
  name: string;
  description: string | null;
  githubUrl: string | null;
  demoUrl: string | null;
  submissionStatus: "draft" | "submitted";
  presentationTimingPreference: "no_preference" | "early" | "middle" | "late";
  responses: Record<string, unknown>;
  revision: number;
  formVersion: number;
  template: TemplateField[];
  sections: FormSection[];
  files?: {
    objectKey: string;
    fieldKey: string;
    fileName: string;
    mimeType: string;
    url: string;
    thumbnailUrl: string | null;
  }[];
  winners?: { challengeId: number; rank: number; challengeTitle: string }[];
  members: {
    userId: number;
    name: string | null;
    status: "active" | "invited" | "declined";
    photoUrl: string | null;
  }[];
  challenges: {
    id: number;
    title: string | Record<string, string>;
    mandatory: boolean;
    status?: string | null;
    position?: number | null;
    etaMinutes?: number | null;
    assignedRoomName?: string | null;
  }[];
}
export interface ProjectDefinition {
  version: number;
  template: TemplateField[];
  sections: FormSection[];
}
export const nativeProjects = {
  mine: () => api.get<{ projects: NativeProject[]; canCreate: boolean }>("/api/me/projects"),
  get: (id: number) => api.get<NativeProject>(`/api/me/projects/${id}`),
  create: (name: string) => api.post<NativeProject>("/api/me/projects", { name }),
  saveDraft: (id: number, responses: Record<string, unknown>, revision: number) =>
    api.put<NativeProject>(`/api/me/projects/${id}/draft`, { responses, revision }),
  update: (
    id: number,
    body: {
      name?: string;
      presentationTimingPreference?: NativeProject["presentationTimingPreference"];
    },
  ) => api.patch<NativeProject>(`/api/me/projects/${id}`, body),
  submit: (id: number) => api.post<NativeProject>(`/api/me/projects/${id}/submit`, {}),
  invite: (id: number, email: string) => api.post(`/api/me/projects/${id}/invites`, { email }),
  respond: (id: number, action: "accept" | "decline") =>
    api.post(`/api/me/projects/${id}/invites/${action}`, {}),
  addChallenge: (id: number, challengeId: number) =>
    api.put(`/api/me/projects/${id}/challenges/${challengeId}`, {}),
  removeChallenge: (id: number, challengeId: number) =>
    api.delete(`/api/me/projects/${id}/challenges/${challengeId}`),
  definition: () => api.get<ProjectDefinition>("/api/projects/form"),
  saveDefinition: (
    body: Pick<ProjectDefinition, "template" | "sections"> & { library_deletions?: string[] },
  ) => api.put<ProjectDefinition>("/api/projects/form", body),
};
