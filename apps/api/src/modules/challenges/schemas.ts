import { i18nTextSchema, questionnaireSchema } from "@hackos/shared/questions";
import { z } from "zod";

/** Schemas for the challenge-editing surface (H44). */

export const challengeIdParam = z.object({ id: z.coerce.number().int().positive() });

const prizeSchema = z.object({
  name: z.string().min(1),
  link: z.string().url().nullish(),
});

/**
 * Partial edit of the sponsor-owned surface of a challenge. `judgingPanelCriteria`
 * is the typed questionnaire the judges will fill in; it is validated against
 * the shared question catalogue and locked once judging starts.
 */
export const updateChallengeBody = z
  .object({
    title: z.string().min(1).optional(),
    titleI18n: i18nTextSchema.optional(), // per-language title (en/es/gl); title mirrors .en
    description: z.string().optional(),
    descriptionI18n: i18nTextSchema.nullish(), // per-language description
    criteria: z.string().nullable().optional(), // public-facing criteria text
    criteriaI18n: i18nTextSchema.nullish(), // per-language criteria
    prizes: z.array(prizeSchema).nullable().optional(),
    devpostTags: z.array(z.string().min(1)).nullable().optional(),
    judgingPanelCriteria: questionnaireSchema.optional(),
    maxPresentationSeconds: z.number().int().positive().nullable().optional(),
    maxInWaitingArea: z.number().int().min(0).nullable().optional(),
    visibility: z.enum(["visible", "hidden"]).optional(),
    availableFrom: z.coerce.date().nullish(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

export type UpdateChallengeBody = z.infer<typeof updateChallengeBody>;

/**
 * Fields on the "public" surface of a challenge — everything except the judging
 * panel. Once a challenge is published these are frozen for sponsor owners (only
 * admins keep editing them); the judging panel stays owner-editable regardless,
 * until judging starts. See updateChallenge().
 */
export const CHALLENGE_GENERAL_FIELDS = [
  "title",
  "titleI18n",
  "description",
  "descriptionI18n",
  "criteria",
  "criteriaI18n",
  "prizes",
  "devpostTags",
  "visibility",
  "availableFrom",
  "maxInWaitingArea",
] as const;

/**
 * Admin-only creation of a challenge template bound to an enterprise (the
 * sponsor lifecycle, H43/H44). Starts life as draft + hidden; an admin later
 * publishes it to the public route.
 */
export const createChallengeBody = z
  .object({
    enterpriseId: z.number().int().positive(),
    title: z.string().min(1),
    titleI18n: i18nTextSchema.optional(),
    description: z.string().optional(),
    descriptionI18n: i18nTextSchema.nullish(),
    criteria: z.string().nullable().optional(),
    criteriaI18n: i18nTextSchema.nullish(),
    prizes: z.array(prizeSchema).nullable().optional(),
    devpostTags: z.array(z.string().min(1)).nullable().optional(),
    judgingPanelCriteria: questionnaireSchema.optional(),
    maxPresentationSeconds: z.number().int().positive().nullable().optional(),
    maxInWaitingArea: z.number().int().min(0).nullable().optional(),
    availableFrom: z.coerce.date().nullish(),
  })
  .strict();

export type CreateChallengeBody = z.infer<typeof createChallengeBody>;

/**
 * Publishing a challenge (H45). `availableFrom` schedules the reveal: the public
 * route stays quiet until then. Omit it (or null) to reveal immediately.
 */
export const publishChallengeBody = z
  .object({
    availableFrom: z.coerce.date().nullish(),
  })
  .strict();

export type PublishChallengeBody = z.infer<typeof publishChallengeBody>;

/**
 * Admin bulk visibility flip (H45): select challenges in the list and reveal or
 * hide them in one call. `visible: true` makes them public immediately.
 */
export const bulkVisibilityBody = z
  .object({
    ids: z.array(z.number().int().positive()).min(1),
    visible: z.boolean(),
  })
  .strict();

export type BulkVisibilityBody = z.infer<typeof bulkVisibilityBody>;
