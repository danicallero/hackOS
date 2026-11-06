/**
 * The only pages search engines may index. `app/robots.ts` allows them and the
 * `next.config.ts` X-Robots-Tag rule exempts them; every other page also says
 * noindex in its own metadata.
 */
export const INDEXABLE_PUBLIC_PATHS = ["timetable", "privacy", "terms", "gallery", "llms.txt"];
