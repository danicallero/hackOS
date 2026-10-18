export interface ChallengeOption {
  id: number;
  title: Record<string, string> | string;
}

/** i18n challenge title from `GET /api/public/challenges` (title is a record);
 * `language` picks that translation first. */
export function challengeTitleText(
  title: Record<string, string> | string | undefined,
  language?: string,
): string {
  if (!title) return "";
  if (typeof title === "string") return title;
  return (language && title[language]) || title.en || title.es || Object.values(title)[0] || "";
}
