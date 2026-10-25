import { z } from "zod";

/** Shared application/project form contract (#1007). */
export const FIELD_KINDS = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "checkbox",
  "birth_year",
  "date",
  "number",
  "phone",
  "file",
  "university",
  "degree",
  "city",
  "images",
  "library",
] as const;

/**
 * H16: an `images` answer is an ordered list of uploaded photo keys. Project
 * forms only; the mobile app opens the system photo picker for it.
 */
export const MAX_IMAGES_PER_FIELD = 10;

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
 * H27: a question becomes a statistics panel only when its author explicitly
 * publishes it.  Keeping the panel configuration beside the question keeps
 * the deployment/form snapshot as the source of truth for both the response
 * validator and the reporting catalog.
 */
export const STATISTICS_VISUALIZATIONS = ["bar", "pie", "line"] as const;
export const STATISTICS_AGGREGATIONS = ["count", "sum", "average"] as const;
export const STATISTICS_TRANSFORMATIONS = ["none", "age", "study_level"] as const;

export const statisticsConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    label: i18nSchema.optional(),
    visualization: z.enum(STATISTICS_VISUALIZATIONS).optional(),
    aggregation: z.enum(STATISTICS_AGGREGATIONS).default("count"),
    transformation: z.enum(STATISTICS_TRANSFORMATIONS).default("none"),
    /** Four-year programmes are the default; event authors can override this. */
    program_years: z.number().int().min(1).max(12).optional(),
  })
  .strict();

export type StatisticsConfig = z.infer<typeof statisticsConfigSchema>;

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
  /** birth_year only: reject applicants younger than this many years. */
  min_age: z.number().int().min(0).max(120).optional(),
  /** Shown to the applicant instead of the generic message when a rule fails. */
  error_message: i18nSchema.optional(),
});

export type FieldValidation = z.infer<typeof fieldValidationSchema>;

// Shape checks for `text_condition` "email"/"url", shared by the API and web
// so they cannot drift. Applicant input can be as long as the request body, so
// the length cap runs first and each check is linear: a single-class regex plus
// a dot search, instead of the earlier `[^\s@]+\.[^\s@]+` style patterns that
// backtracked quadratically on long non-matching input (#1110).
export const EMAIL_MAX_LENGTH = 320;
export const URL_MAX_LENGTH = 2048;
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+$/;
const URL_SHAPE_RE = /^[^\s/$.?#]\S*$/;

/** `local@domain` where the domain has a dot that is neither first nor last. */
export function isSimpleEmail(value: string): boolean {
  if (value.length > EMAIL_MAX_LENGTH || !EMAIL_SHAPE_RE.test(value)) return false;
  return value.slice(value.indexOf("@") + 2, -1).includes(".");
}

/**
 * Domain-shaped value: a dot after the first character with at least two
 * characters after it. A scheme (http:// or https://) is optional — applicants
 * shouldn't have to type it for this to count as a URL.
 */
export function isSimpleUrl(value: string): boolean {
  if (value.length > URL_MAX_LENGTH || !URL_SHAPE_RE.test(value)) return false;
  return value.slice(1, -2).includes(".");
}

export const templateFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.-]+$/, "field key must be alphanumeric/._-"),
    label: i18nSchema,
    kind: z.enum(FIELD_KINDS),
    library_id: z.uuid().optional(),
    required: z.boolean().default(false),
    options: z.array(optionSchema).optional(),
    allowed_file_types: z.array(z.string()).optional(),
    max_file_size_mb: z.number().int().positive().optional(),
    /** File fields only (H56): lets an applicant consent to sharing this
     *  upload with sponsors; see sponsorShareKey for the response convention. */
    shareable_with_sponsors: z.boolean().optional(),
    /** File fields only (#935): this upload is the applicant's public-profile
     *  CV. At most one per form; see directory/service.ts formCvSql. Optional:
     *  a file field named CV/curriculum/resume is picked up automatically. */
    profile_cv: z.boolean().optional(),
    /** Project form text fields only (H16): this answer is the project's
     *  description everywhere (lists, gallery, cards). At most one. A text
     *  field keyed `description` plays this role when no field is marked. */
    project_description: z.boolean().optional(),
    /** H16: render this configurable text question as a YouTube video. */
    project_video: z.boolean().optional(),
    /** Project form URL text fields only: shown as an action link in the judging panel. */
    judging_link: z.boolean().optional(),
    /** Groups this field under a `FormSection.key` (H11 form builder sections). */
    section_key: z.string().optional(),
    /** H11: ungrouped fields can follow a named section without joining it. */
    after_section_key: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.-]+$/, "section key must be alphanumeric/._-")
      .optional(),
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
    /** H27 configurable question-statistics definition. */
    statistics: statisticsConfigSchema.optional(),
  })
  .strict()
  .refine((field) => field.section_key === undefined || field.after_section_key === undefined, {
    message: "a field cannot have both section_key and after_section_key",
  })
  .refine(
    (f) => !(f.kind === "select" || f.kind === "multiselect") || (f.options?.length ?? 0) > 0,
    { message: "select/multiselect fields require a non-empty options array" },
  )
  .refine((f) => !f.profile_cv || f.kind === "file", {
    message: "only a file field can be the profile CV",
  })
  .refine((f) => !f.project_description || f.kind === "text" || f.kind === "textarea", {
    message: "only a text field can be the project description",
  })
  .refine((f) => !f.project_video || f.kind === "text", {
    message: "only a text field can be a project video",
  })
  .refine((f) => !f.judging_link || f.kind === "text", {
    message: "only a text field can be a judging link",
  });

export const libraryDeletionsSchema = z.array(z.uuid());

export const templateSchema = z
  .array(templateFieldSchema)
  .refine(
    (fields) => {
      const ids = fields.flatMap((field) => (field.library_id ? [field.library_id] : []));
      return new Set(ids).size === ids.length;
    },
    { message: "each question must own a distinct library" },
  )
  .refine((fields) => new Set(fields.map((f) => f.key)).size === fields.length, {
    message: "template field keys must be unique",
  })
  .refine((fields) => fields.filter((f) => f.profile_cv).length <= 1, {
    message: "only one field can be the profile CV",
  })
  .refine((fields) => fields.filter((f) => f.project_description).length <= 1, {
    message: "only one field can be the project description",
  });

/**
 * H16: the project form field whose answer is the project's description: the
 * one marked `project_description`, else a text field keyed `description`.
 */
export function projectDescriptionField<
  T extends { key: string; kind: string; project_description?: boolean },
>(template: readonly T[]): T | undefined {
  const isText = (field: T) => field.kind === "text" || field.kind === "textarea";
  return (
    template.find((field) => field.project_description && isText(field)) ??
    template.find((field) => field.key === "description" && isText(field))
  );
}

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

/** H11: grouping and ungrouped placement anchors must name a defined section. */
export function fieldsReferenceKnownSections(
  fields: TemplateField[],
  sections: FormSection[],
): boolean {
  const keys = new Set(sections.map((s) => s.key));
  return fields.every((field) =>
    [field.section_key, field.after_section_key].every((key) => key === undefined || keys.has(key)),
  );
}
