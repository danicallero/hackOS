import { z } from "zod";

/** Schemas for enterprise (sponsor) management (H43-H45). */

export const enterpriseIdParam = z.object({ id: z.coerce.number().int().positive() });

export const visibilityEnum = z.enum(["visible", "hidden"]);

export const createEnterpriseBody = z
  .object({
    name: z.string().min(1),
    website: z.string().url().nullish(),
    logoUrl: z.string().url().nullish(),
    logoNegativeUrl: z.string().url().nullish(),
    description: z.string().nullish(),
    tierId: z.number().int().positive().nullish(),
    displayPriority: z.number().int().positive().nullish(),
    visibility: visibilityEnum.default("hidden"),
    availableFrom: z.coerce.date().nullish(),
  })
  .strict();

/**
 * Superset patch. Admins may set every field; owners are limited to their
 * profile (website/logoUrl/description) — enforced in the route by rejecting
 * the admin-only keys below.
 */
export const updateEnterpriseBody = z
  .object({
    name: z.string().min(1).optional(),
    website: z.string().url().nullish(),
    logoUrl: z.string().url().nullish(),
    logoNegativeUrl: z.string().url().nullish(),
    description: z.string().nullish(),
    tierId: z.number().int().positive().nullish(),
    displayPriority: z.number().int().positive().nullish(),
    visibility: visibilityEnum.optional(),
    availableFrom: z.coerce.date().nullish(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

export const OWNER_EDITABLE_KEYS = [
  "website",
  "logoUrl",
  "logoNegativeUrl",
  "description",
] as const;

/** Admin bulk visibility flip from the enterprises list (H45). */
export const bulkVisibilityBody = z
  .object({
    ids: z.array(z.number().int().positive()).min(1),
    visible: z.boolean(),
  })
  .strict();

export type BulkVisibilityBody = z.infer<typeof bulkVisibilityBody>;

/** M4: affiliate a user with an enterprise. */
export const addMemberBody = z.object({ userId: z.number().int().positive() }).strict();

export const memberParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

/** DELTA(Hxx): add a user to an enterprise's judge roster (`enterprise_judges`). */
export const addJudgeBody = z.object({ userId: z.number().int().positive() }).strict();

export const judgeParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
] as const;

export const CONTENT_TYPE_EXT: Record<(typeof LOGO_CONTENT_TYPES)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif",
};

export type CreateEnterpriseBody = z.infer<typeof createEnterpriseBody>;
export type UpdateEnterpriseBody = z.infer<typeof updateEnterpriseBody>;

/**
 * H58: sponsor-only FAQ — an ordered list of admin-authored items, each
 * either a question/answer pair (`kind: 'qa'`) or a free-form text block
 * (`kind: 'text'`), trilingual like challenge text. Saved wholesale, same
 * shape as `challenges.prizes`/`judging_panel_criteria`.
 */
const i18nText = z.object({ en: z.string(), es: z.string(), gl: z.string() });

export const faqItem = z.object({
  kind: z.enum(["qa", "text"]),
  heading: i18nText,
  body: i18nText,
});

export const sponsorFaqBody = z
  .object({
    items: z.array(faqItem).max(100),
  })
  .strict();

export type FaqItem = z.infer<typeof faqItem>;

export type SponsorFaqBody = z.infer<typeof sponsorFaqBody>;
