import { z } from "zod";

/**
 * Zod schemas for the applications module (H11-H15, H27, H56).
 *
 * The application `template` is a form schema: an ordered array of field
 * definitions the client renders dynamically. Response values are keyed by
 * `field.key`. i18n labels carry en/es/gl per plan/07 §2.
 */

export * from "@hackos/shared/forms";

import { fieldsReferenceKnownSections, sectionsSchema, templateSchema } from "@hackos/shared/forms";

const timestampCoerce = z.union([z.string(), z.null()]).optional();

/** H16: photo-list fields upload through project storage; applications have no such route. */
const noImagesFields = (template: { kind: string }[] | undefined) =>
  !template?.some((field) => field.kind === "images");
const NO_IMAGES_MESSAGE = "image fields are only available in the project form";

export const createApplicationSchema = z
  .object({
    name: z.string().min(1),
    template: templateSchema,
    sections: sectionsSchema.default([]),
    description: z.string().nullish(),
    open_at: timestampCoerce,
    close_at: timestampCoerce,
    capacity: z.number().int().positive().nullish(),
    confirmation_window_hours: z.number().int().positive().default(168),
    ask_shirt_size: z.boolean().default(false),
    ask_food_intolerances: z.boolean().default(false),
    // H8/H11: roles granted alongside ticket issuance on confirmation.
    // Omitted/null grants nothing.
    grants_role_ids: z.array(z.number().int().positive()).nullish(),
  })
  .strict()
  .refine((b) => fieldsReferenceKnownSections(b.template, b.sections), {
    message: "every field's section_key or after_section_key must reference a defined section",
    path: ["template"],
  })
  .refine((b) => noImagesFields(b.template), { message: NO_IMAGES_MESSAGE, path: ["template"] });

export const updateApplicationSchema = z
  .object({
    name: z.string().min(1).optional(),
    template: templateSchema.optional(),
    sections: sectionsSchema.optional(),
    description: z.string().nullish(),
    open_at: timestampCoerce,
    close_at: timestampCoerce,
    capacity: z.number().int().positive().nullish(),
    confirmation_window_hours: z.number().int().positive().optional(),
    ask_shirt_size: z.boolean().optional(),
    ask_food_intolerances: z.boolean().optional(),
    // Omitted = leave the form's role grants unchanged; explicit [] clears
    // every grant; a non-empty array replaces the full set (H8/H11).
    grants_role_ids: z.array(z.number().int().positive()).nullish(),
    /** Explicit builder key renames, used to carry existing answers forward (H11, H12). */
    field_renames: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).optional(),
  })
  .strict()
  .refine(
    // Only checkable when both sides of the PATCH are present together — a
    // partial update touching just one of template/sections can't be
    // validated against the other half without the current DB row.
    (b) =>
      b.template === undefined ||
      b.sections === undefined ||
      fieldsReferenceKnownSections(b.template, b.sections),
    {
      message: "every field's section_key or after_section_key must reference a defined section",
      path: ["template"],
    },
  )
  .refine((b) => noImagesFields(b.template), { message: NO_IMAGES_MESSAGE, path: ["template"] });

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
export const uploadQuerySchema = z.object({
  /** Present only when staff correct an existing response. */
  responseId: z.coerce.number().int().positive().optional(),
});
export const responseIdParamSchema = z.object({
  responseId: z.coerce.number().int().positive(),
});

/** Draft save: free-form response object, validated against the template only at submit. */
export const saveDraftSchema = z.object({
  responses: z.record(z.string(), z.unknown()).default({}),
});

export const submitSchema = z.object({
  responses: z.record(z.string(), z.unknown()).optional(),
  food_intolerances: z.array(z.number().int().positive()).default([]),
  food_intolerance_notes: z.string().nullish(),
  shirt_size: z.string().min(1).nullish(),
});

export const reviewUpsertSchema = z.object({
  score: z.number().int().min(0).max(5).nullish(),
  notes: z.string().nullish(),
});

export const staffNotesSchema = z.object({ staff_notes: z.string().nullish() });

export const decideSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
});

export const sendDecisionsSchema = z.object({
  include_rejected: z.boolean().default(false),
});

export const confirmTokenSchema = z.object({ token: z.string().min(1) });

/**
 * Email-link confirm response (H15, issue #369). `wallet_token` is scoped to
 * this user's entrance pass and expires; it is never a session credential.
 */
export const confirmByEmailResponseSchema = z.object({
  status: z.string(),
  already_confirmed: z.boolean(),
  ticket_token: z.string(),
  user_id: z.number().int(),
  masked_email: z.string(),
  holder_name: z.string(),
  // Keep the historical string contract for the already-published client:
  // a form whose confirmed roles grant no event access returns an empty
  // string instead of changing the field type to null.
  wallet_token: z.string(),
  wallet_token_expires_at: z.string(),
});

export const listResponsesQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
});

// ── batch operations ─────────────────────────────────────────────────────────

export const batchIdsSchema = z.object({
  response_ids: z.array(z.number().int().positive()).min(1).max(100),
});

export const batchDecideSchema = batchIdsSchema.extend({
  decision: z.enum(["accepted", "rejected"]),
});

export const batchSendDecisionsSchema = batchIdsSchema;

export const batchRevertDecisionSchema = batchIdsSchema.extend({
  decision: z.enum(["accepted", "rejected", "review"]),
});

export const revertDecisionSchema = z.object({
  decision: z.enum(["accepted", "rejected", "review"]),
});

/** H12/H14: return one response to its owner for revision. */
export const returnToDraftSchema = z.object({
  /** Applies only to this returned draft, never reopens the whole form. */
  allow_resubmit_after_close: z.boolean().default(false),
  /** On the next valid submit, send a fresh acceptance + confirmation link. */
  auto_accept_on_resubmit: z.boolean().default(false),
});
