import { z } from "zod";

/**
 * Zod schemas for the applications module (H11-H15, H27, H56).
 *
 * The application `template` is a form schema: an ordered array of field
 * definitions the client renders dynamically. Response values are keyed by
 * `field.key`. i18n labels carry en/es/gl per plan/07 §2.
 */

export const FIELD_KINDS = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "date",
  "number",
  "file",
  "university",
] as const;

/**
 * Retention is an extensible field policy, not a collection of booleans.  A
 * missing value is treated as `none` by the storage boundary so legacy forms
 * remain minimised and newly-added questions are never retained by accident.
 */
export const RETENTION_MODES = ["none", "anonymous_audit"] as const;
export type RetentionMode = (typeof RETENTION_MODES)[number];
export const retentionModeSchema = z.enum(RETENTION_MODES);

/**
 * Optional stable reporting vocabulary for a retained answer.  This is
 * deliberately an open slug rather than an enum: the initial event uses
 * age/gender/university/degree/graduation_year/origin_city, while future
 * events may add dimensions without changing anonymization code.
 */
export const anonymousAuditDimensionSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, "audit dimension must be a stable slug")
  .nullable()
  .optional();

const i18nSchema = z.object({
  en: z.string(),
  es: z.string(),
  gl: z.string(),
});

const optionSchema = z.object({
  value: z.string().min(1),
  label: i18nSchema,
});

/**
 * Response-validation rules (H11), checked by `validateResponses` at submit
 * time on top of the kind-shape check. Which sub-fields apply depends on
 * `kind`: min_length/max_length/pattern for text/textarea, min/max for
 * number, min_selected/max_selected for multiselect. Fields irrelevant to a
 * given kind are simply ignored rather than rejected, so switching kind
 * doesn't require clearing out unrelated validation state.
 */
export const TEXT_VALIDATION_CONDITIONS = ["contains", "not_contains", "email", "url"] as const;

export const fieldValidationSchema = z.object({
  min_length: z.number().int().nonnegative().optional(),
  max_length: z.number().int().positive().optional(),
  pattern: z.string().optional(),
  /** text/textarea only: a "contains"/"doesn't contain" condition needs
   *  `text_value`; "email"/"url" check the value's own shape instead. */
  text_condition: z.enum(TEXT_VALIDATION_CONDITIONS).optional(),
  text_value: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  min_selected: z.number().int().nonnegative().optional(),
  max_selected: z.number().int().positive().optional(),
  /** Shown to the applicant instead of the generic message when a rule fails. */
  error_message: i18nSchema.optional(),
});

export type FieldValidation = z.infer<typeof fieldValidationSchema>;

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
    /** Groups this field under a `FormSection.key` (H11 form builder sections). */
    section_key: z.string().optional(),
    /** Small helper text shown under the field (H11), e.g. a privacy note or
     *  formatting hint. Plain text; URLs are auto-linked on render. */
    help_text: i18nSchema.optional(),
    /** Placeholder shown inside the empty input, for kinds the applicant
     *  types into (text/textarea/number). Falls back to a generic string. */
    placeholder: i18nSchema.optional(),
    validation: fieldValidationSchema.optional(),
    /** Explicit field-level policy for the permanent anonymous audit record. */
    retention_mode: retentionModeSchema.optional(),
    /** Optional stable reporting dimension; never controls retention by itself. */
    anonymous_audit_dimension: anonymousAuditDimensionSchema,
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

/** A named group of template fields (H11 form builder sections): title +
 *  optional description, rendered as a header above its member fields. */
export const sectionSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.-]+$/, "section key must be alphanumeric/._-"),
  title: i18nSchema,
  description: i18nSchema.optional(),
});

export const sectionsSchema = z
  .array(sectionSchema)
  .refine((sections) => new Set(sections.map((s) => s.key)).size === sections.length, {
    message: "section keys must be unique",
  });

export type FormSection = z.infer<typeof sectionSchema>;

/** Every field's `section_key`, if set, must reference a defined section. */
function fieldsReferenceKnownSections(fields: TemplateField[], sections: FormSection[]): boolean {
  const keys = new Set(sections.map((s) => s.key));
  return fields.every((f) => f.section_key === undefined || keys.has(f.section_key));
}

const timestampCoerce = z.union([z.string(), z.null()]).optional();

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
    message: "every field's section_key must reference a defined section",
    path: ["template"],
  });

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
    { message: "every field's section_key must reference a defined section", path: ["template"] },
  );

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
