import { apiFetch } from "./api";

/** Sponsor/participant/mentor (H59 vocabulary) plus staff — anyone holding at least one capability — for H50 announcement targeting. */
export type AnnouncementAudience = "sponsor" | "participant" | "mentor" | "staff";
export const ANNOUNCEMENT_AUDIENCES: AnnouncementAudience[] = [
  "sponsor",
  "participant",
  "mentor",
  "staff",
];

export type AnnouncementChannel = "in_app" | "email" | "push";
export const ANNOUNCEMENT_CHANNELS: AnnouncementChannel[] = ["in_app", "email", "push"];

export type AnnouncementScreenPlacement = "none" | "embedded" | "fullscreen";
export const ANNOUNCEMENT_SCREEN_PLACEMENTS: AnnouncementScreenPlacement[] = [
  "none",
  "embedded",
  "fullscreen",
];

export type AnnouncementLanguage = "es" | "gl" | "en";
export type AnnouncementTranslation = { title: string; body: string };
export type AnnouncementTranslations = Partial<
  Record<AnnouncementLanguage, AnnouncementTranslation>
>;

export interface AnnouncementRecipient {
  id: number;
  name: string | null;
  surname: string | null;
  email: string;
}

/** Admin record — `GET /api/announcements` and `GET /api/announcements/:id`. */
export interface AdminAnnouncement {
  id: number;
  author_id: number;
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notify_users: boolean;
  screen_placement: AnnouncementScreenPlacement;
  publish_at: string | null;
  expires_at: string | null;
  fanned_out_at: string | null;
  audiences: AnnouncementAudience[];
  channels: AnnouncementChannel[];
  created_at: string;
  /** Only present on the single-announcement GET. */
  recipients?: AnnouncementRecipient[];
}

export interface AnnouncementInput {
  title: string;
  body: string;
  translations: AnnouncementTranslations;
  notifyUsers: boolean;
  screenPlacement: AnnouncementScreenPlacement;
  publishAt: string | null;
  expiresAt: string | null;
  audiences: AnnouncementAudience[];
  channels: AnnouncementChannel[];
  recipientUserIds: number[];
}

export async function fetchAdminAnnouncements(): Promise<AdminAnnouncement[]> {
  const response = await apiFetch<{ items: AdminAnnouncement[] }>("/api/announcements");
  return response.items;
}

export async function fetchAnnouncement(id: number): Promise<AdminAnnouncement> {
  return apiFetch<AdminAnnouncement>(`/api/announcements/${id}`);
}

export async function createAnnouncement(body: AnnouncementInput): Promise<AdminAnnouncement> {
  return apiFetch<AdminAnnouncement>("/api/announcements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateAnnouncement(
  id: number,
  body: Partial<AnnouncementInput>,
): Promise<AdminAnnouncement> {
  return apiFetch<AdminAnnouncement>(`/api/announcements/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteAnnouncement(id: number): Promise<void> {
  await apiFetch<{ ok: true }>(`/api/announcements/${id}`, { method: "DELETE" });
}

export async function fetchAnnouncementRecipientCandidates(
  q: string,
  limit = 8,
): Promise<AnnouncementRecipient[]> {
  const response = await apiFetch<{ users: AnnouncementRecipient[] }>(
    `/api/announcements/recipient-candidates?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  return response.users;
}

/** Whether the deployment has a translation provider configured — hide/disable the action when false. */
export async function fetchTranslateAvailability(): Promise<boolean> {
  const response = await apiFetch<{ available: boolean }>(
    "/api/announcements/translate-availability",
  );
  return response.available;
}

export async function translateAnnouncement(input: {
  title: string;
  body: string;
  sourceLanguage: AnnouncementLanguage;
  targetLanguages: AnnouncementLanguage[];
}): Promise<AnnouncementTranslations> {
  const response = await apiFetch<{ translations: AnnouncementTranslations }>(
    "/api/announcements/translate",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return response.translations;
}
