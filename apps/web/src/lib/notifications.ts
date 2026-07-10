/**
 * Typed client for the notifications/announcements/audit API (H50, H51,
 * H53). Thin wrappers over `@/lib/api` mirroring the read shapes in
 * `apps/api/src/modules/notifications/*`. Keep these in sync with the
 * backend; when a shape is unclear, read the module.
 */
import { api } from "./api";

export type NotificationChannel = "in_app" | "email" | "push" | "discord";

export interface Announcement {
  id: number;
  author_id: number;
  title: string;
  body: string;
  target_role: string | null;
  publish_at: string | null;
  expires_at: string | null;
  fanned_out_at: string | null;
  created_at: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  targetRole: string | null;
  publishAt: string | null;
  expiresAt: string | null;
}

/** The outbox row itself IS the inbox item; `read_at` doubles as the read marker. */
export interface InboxItem {
  id: number;
  category: string;
  payload: unknown;
  status: string;
  sent_at: string | null;
  read_at: string | null;
  created_at: string;
}

export interface PreferenceOverride {
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface PreferencesResponse {
  channels: NotificationChannel[];
  mandatoryCategories: string[];
  overrides: PreferenceOverride[];
}

/** Categories every user sees in the matrix even with zero override rows (mirrors service.ts STATIC_CATEGORIES). */
export const STATIC_CATEGORIES = ["announcements", "application"];

export interface AuditRow {
  id: number;
  actor_id: number | null;
  entity_type: string;
  entity_id: string;
  action: string;
  source: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  actorId?: number;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}

export const notificationsApi = {
  listAnnouncements: () => api.get<{ items: Announcement[] }>("/api/announcements"),
  getAnnouncement: (id: number) => api.get<Announcement>(`/api/announcements/${id}`),
  createAnnouncement: (body: AnnouncementInput) =>
    api.post<Announcement>("/api/announcements", { ...body }),
  updateAnnouncement: (id: number, body: Partial<AnnouncementInput>) =>
    api.put<Announcement>(`/api/announcements/${id}`, { ...body }),
  deleteAnnouncement: (id: number) => api.delete<{ ok: true }>(`/api/announcements/${id}`),

  listInbox: (opts: { unread?: boolean; limit: number; offset: number }) =>
    api.get<{ items: InboxItem[]; total: number }>("/api/me/notifications", {
      query: { unread: opts.unread, limit: opts.limit, offset: opts.offset },
    }),
  markInboxRead: (id: number) =>
    api.post<{ id: number; read_at: string }>(`/api/me/notifications/${id}/read`),

  getPreferences: () => api.get<PreferencesResponse>("/api/me/notification-preferences"),
  setPreferences: (items: PreferenceOverride[]) =>
    api.put<PreferencesResponse>("/api/me/notification-preferences", { preferences: items }),

  queryAudit: (filters: AuditFilters) =>
    api.get<{ items: AuditRow[]; total: number }>("/api/audit", { query: { ...filters } }),
};
