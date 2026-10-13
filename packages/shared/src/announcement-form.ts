import type { Language } from "./locale.js";
export type AnnouncementChannel = "in_app" | "email" | "push";
export type AnnouncementScreenPlacement = "none" | "embedded" | "fullscreen";
export type AnnouncementTranslations = Partial<Record<Language, { title: string; body: string }>>;
export interface AnnouncementInput {
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notifyUsers: boolean;
  screenPlacement: AnnouncementScreenPlacement;
  publishAt: string | null;
  expiresAt: string | null;
  roleIds: number[];
  intoleranceIds: number[];
  channels: AnnouncementChannel[];
  recipientUserIds: number[];
}

export type AnnouncementFormValues = Omit<AnnouncementInput, "translations"> & {
  translations: Record<Language, { title: string; body: string }>;
};

export interface AnnouncementFormSource {
  title: string;
  body: string;
  translations?: AnnouncementTranslations | null;
  notify_users: boolean;
  screen_placement: AnnouncementScreenPlacement;
  publish_at: string | null;
  expires_at: string | null;
  role_ids?: number[];
  intolerance_ids?: number[];
  channels?: AnnouncementChannel[];
  recipients?: { id: number }[];
}
export function announcementToForm(a: AnnouncementFormSource): AnnouncementFormValues {
  return {
    title: a.title,
    body: a.body,
    translations: {
      es: a.translations?.es ?? { title: a.title, body: a.body },
      gl: a.translations?.gl ?? { title: "", body: "" },
      en: a.translations?.en ?? { title: "", body: "" },
    },
    notifyUsers: a.notify_users,
    screenPlacement: a.screen_placement,
    publishAt: a.publish_at,
    expiresAt: a.expires_at,
    roleIds: a.role_ids ?? [],
    intoleranceIds: a.intolerance_ids ?? [],
    channels: a.channels ?? ["in_app", "email", "push"],
    recipientUserIds: (a.recipients ?? []).map((r) => r.id),
  };
}
export function emptyAnnouncementForm(): AnnouncementFormValues {
  return {
    title: "",
    body: "",
    translations: {
      es: { title: "", body: "" },
      gl: { title: "", body: "" },
      en: { title: "", body: "" },
    },
    notifyUsers: false,
    screenPlacement: "none",
    publishAt: null,
    expiresAt: null,
    roleIds: [],
    intoleranceIds: [],
    channels: ["in_app", "email", "push"],
    recipientUserIds: [],
  };
}

export type TargetingMode = "everyone" | "roles" | "specific";
export function targetingModeOf(values: AnnouncementInput): TargetingMode {
  if (values.recipientUserIds.length > 0) return "specific";
  if (values.roleIds.length > 0 || values.intoleranceIds.length > 0) return "roles";
  return "everyone";
}
