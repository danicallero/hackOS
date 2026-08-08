import { z } from "zod";

/**
 * Zod schemas for the applications module (H11-H15, H27, H56).
 *
 * The application `template` is a form schema: an ordered array of field
 * definitions the client renders dynamically. Response values are keyed by
 * `field.key`. i18n labels carry en/es/gl per plan/07 §2.
 */

export const APPLICATION_TYPES = ["participant", "mentor", "sponsor", "volunteer"] as const;
export type ApplicationType = (typeof APPLICATION_TYPES)[number];

export const FIELD_KINDS = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "number",
  "file-url",
  "file",
  "university",
] as const;

const i18nSchema = z.object({
  en: z.string(),
  es: z.string(),
  gl: z.string(),
});

const optionSchema = z.object({
  value: z.string().min(1),
  label: i18nSchema,
});

export const templateFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.-]+$/, "field key must be alphanumeric/._-"),
    label: i18nSchema,
    kind: z.enum(FIELD_KINDS),
    required: z.boolean().default(false),
    options: z.array(optionSchema).optional(),
    allowed_file_types: z.array(z.string()).optional(),
    max_file_size_mb: z.number().int().positive().optional(),
    /** File fields only (H56): lets an applicant consent to sharing this
     *  upload with sponsors; see sponsorShareKey for the response convention. */
    shareable_with_sponsors: z.boolean().optional(),
  })
  .refine(
    (f) => !(f.kind === "select" || f.kind === "multiselect") || (f.options?.length ?? 0) > 0,
    { message: "select/multiselect fields require a non-empty options array" },
  );

export const templateSchema = z
  .array(templateFieldSchema)
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: "template field keys must be unique",
  });

export type TemplateField = z.infer<typeof templateFieldSchema>;

const timestampCoerce = z.union([z.string(), z.null()]).optional();

export const createApplicationSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(APPLICATION_TYPES),
    template: templateSchema,
    description: z.string().nullish(),
    active: z.boolean().default(true),
    open_at: timestampCoerce,
    close_at: timestampCoerce,
    capacity: z.number().int().positive().nullish(),
    confirmation_window_hours: z.number().int().positive().default(168),
    ask_shirt_size: z.boolean().default(false),
    ask_food_intolerances: z.boolean().default(false),
  })
  .strict();

export const updateApplicationSchema = z
  .object({
    name: z.string().min(1).optional(),
    type: z.enum(APPLICATION_TYPES).optional(),
    template: templateSchema.optional(),
    description: z.string().nullish(),
    active: z.boolean().optional(),
    open_at: timestampCoerce,
    close_at: timestampCoerce,
    capacity: z.number().int().positive().nullish(),
    confirmation_window_hours: z.number().int().positive().optional(),
    ask_shirt_size: z.boolean().optional(),
    ask_food_intolerances: z.boolean().optional(),
  })
  .strict();

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
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
  score: z.number().int().min(0).max(100).nullish(),
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
  wallet_token: z.string(),
  wallet_token_expires_at: z.string(),
});

export const listResponsesQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
});

export const statsQuerySchema = z.object({
  field: z.string().optional(),
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
