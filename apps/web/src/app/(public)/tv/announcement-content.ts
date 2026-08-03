import type { PublicAnnouncement } from "@/components/public/public-types";
import type { Language } from "@/lib/types";

/** Chooses an announcement's localized wall copy. Legacy/base fields remain a
 * per-field fallback so an incomplete translation never produces a blank TV. */
export function announcementContent(
  announcement: PublicAnnouncement,
  language: Language,
): { title: string; body: string } {
  const translated = announcement.translations?.[language];
  return {
    title: translated?.title.trim() || announcement.title,
    body: translated?.body.trim() || announcement.body,
  };
}
