import { questionnaireSchema } from "@hackos/shared/questions";
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
    description: z.string().optional(),
    criteria: z.string().nullable().optional(), // public-facing criteria text
    prizes: z.array(prizeSchema).nullable().optional(),
    judgingPanelCriteria: questionnaireSchema.optional(),
    maxPresentationSeconds: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });

export type UpdateChallengeBody = z.infer<typeof updateChallengeBody>;
