import { z } from "zod";

/**
 * Typed question catalogue shared by the judging panel builder (H44) and,
 * going forward, any dynamic form the client renders from JSONB. A panel /
 * form is an ordered array of questions; a judge's / applicant's answers are
 * an object keyed by `question.key`.
 *
 * Kinds:
 *   scale         — integer slider, default 0..10 (configurable per question)
 *   boolean       — yes / no
 *   single_choice — pick exactly one option (radio / multiple choice)
 *   multi_choice  — pick zero or more options (checkboxes)
 *   short_text    — one-line free text
 *   long_text     — multi-line free text
 *
 * i18n labels carry en/es/gl per plan/07 §2. Every question can be marked
 * `required`, which is enforced only when a response is *submitted* (drafts
 * stay lenient) — see `validateAnswers`.
 */

export const QUESTION_KINDS = [
  "scale",
  "boolean",
  "single_choice",
  "multi_choice",
  "short_text",
  "long_text",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const i18nTextSchema = z.object({
  en: z.string(),
  es: z.string(),
  gl: z.string(),
});
export type I18nText = z.infer<typeof i18nTextSchema>;

export const questionOptionSchema = z.object({
  value: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.-]+$/, "option value must be alphanumeric/._-"),
  label: i18nTextSchema,
});

const baseShape = {
  key: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_.-]+$/, "question key must be alphanumeric/._-"),
  label: i18nTextSchema,
  description: i18nTextSchema.optional(),
  required: z.boolean().default(false),
};

export const questionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...baseShape,
    kind: z.literal("scale"),
    min: z.number().int().default(0),
    max: z.number().int().default(10),
  }),
  z.object({ ...baseShape, kind: z.literal("boolean") }),
  z.object({
    ...baseShape,
    kind: z.literal("single_choice"),
    options: z.array(questionOptionSchema).min(1),
  }),
  z.object({
    ...baseShape,
    kind: z.literal("multi_choice"),
    options: z.array(questionOptionSchema).min(1),
  }),
  z.object({
    ...baseShape,
    kind: z.literal("short_text"),
    maxLength: z.number().int().positive().default(280),
  }),
  z.object({
    ...baseShape,
    kind: z.literal("long_text"),
    maxLength: z.number().int().positive().default(5000),
  }),
]);
export type Question = z.infer<typeof questionSchema>;

/** A whole panel / form: ordered questions with unique keys and valid scales. */
export const questionnaireSchema = z.array(questionSchema).superRefine((questions, ctx) => {
  const seen = new Set<string>();
  questions.forEach((q, i) => {
    if (seen.has(q.key)) {
      ctx.addIssue({
        code: "custom",
        message: `duplicate question key "${q.key}"`,
        path: [i, "key"],
      });
    }
    seen.add(q.key);
    if (q.kind === "scale" && q.max <= q.min) {
      ctx.addIssue({
        code: "custom",
        message: "scale max must be greater than min",
        path: [i, "max"],
      });
    }
  });
});
export type Questionnaire = z.infer<typeof questionnaireSchema>;

export type AnswerValue = number | boolean | string | string[];
export interface AnswerError {
  key: string;
  message: string;
}

const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Validate a set of answers against a questionnaire. Pure — no I/O — so it is
 * reused by the judging submit path and by tests.
 *
 * - Unknown keys always error (defends against panel drift).
 * - Provided answers are type/range-checked for their kind.
 * - `required` is enforced only when `requireAll` is set (i.e. at submit).
 */
export function validateAnswers(
  questions: Question[],
  answers: Record<string, unknown>,
  opts: { requireAll?: boolean } = {},
): AnswerError[] {
  const errors: AnswerError[] = [];
  const byKey = new Map(questions.map((q) => [q.key, q]));

  for (const key of Object.keys(answers)) {
    if (!byKey.has(key)) errors.push({ key, message: `unknown question "${key}"` });
  }

  for (const q of questions) {
    const v = answers[q.key];
    if (isBlank(v)) {
      if (opts.requireAll && q.required) errors.push({ key: q.key, message: "required" });
      continue;
    }
    switch (q.kind) {
      case "scale":
        if (typeof v !== "number" || !Number.isInteger(v) || v < q.min || v > q.max)
          errors.push({ key: q.key, message: `must be an integer between ${q.min} and ${q.max}` });
        break;
      case "boolean":
        if (typeof v !== "boolean") errors.push({ key: q.key, message: "must be a boolean" });
        break;
      case "single_choice": {
        const allowed = new Set(q.options.map((o) => o.value));
        if (typeof v !== "string" || !allowed.has(v))
          errors.push({ key: q.key, message: "must be one of the options" });
        break;
      }
      case "multi_choice": {
        const allowed = new Set(q.options.map((o) => o.value));
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && allowed.has(x)))
          errors.push({ key: q.key, message: "must be a subset of the options" });
        break;
      }
      case "short_text":
      case "long_text":
        if (typeof v !== "string" || v.length > q.maxLength)
          errors.push({ key: q.key, message: `must be text up to ${q.maxLength} characters` });
        break;
    }
  }
  return errors;
}
