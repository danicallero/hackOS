/**
 * Constants shared across the application-detail route's files (H11-H14).
 */

import type { I18nText } from "@hackos/shared/questions";
import type { FormSection, TemplateField } from "../lib";

/** Locale tab order for every trilingual editor on this page. */
export const LOCALES = ["es", "en", "gl"] as const;

/** A blank trilingual value — every i18n field must carry all three (plan/07 §2). */
export const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

/** Minimal shape of a food-intolerance dictionary entry (public endpoint). */
export interface IntoleranceOption {
  id: number;
  label: I18nText;
}

/**
 * Reserved section the shirt-size/dietary fields are grouped under when a
 * form's logistics toggles are on (H11) — synthetic, never stored in
 * `application.sections`. The `__`-prefixed key can't collide with an
 * admin-authored section (the builder only ever generates lowercase
 * `section_N`/slug keys via `generatedFieldKey`).
 */
export const LOGISTICS_SECTION_KEY = "__logistics__";

export const LOGISTICS_SECTION: FormSection = {
  key: LOGISTICS_SECTION_KEY,
  title: { en: "Logistics", es: "Logística", gl: "Loxística" },
};

function shirtSizePreviewField(sizes: string[]): TemplateField {
  return {
    key: "shirt_size",
    label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
    kind: "select",
    required: true,
    options: sizes.map((s) => ({ value: s, label: { en: s, es: s, gl: s } })),
    section_key: LOGISTICS_SECTION_KEY,
  };
}

const FOOD_NOTES_PREVIEW_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
  section_key: LOGISTICS_SECTION_KEY,
};

/**
 * The shirt-size/dietary fields the server appends to the template at submit
 * time (mirrors `enrichTemplate` in `apps/api/.../applications/service.ts`),
 * so the builder's preview shows exactly what an applicant will see instead
 * of silently omitting logistics fields toggled on in Form settings. Tagged
 * with `LOGISTICS_SECTION_KEY` so they render grouped under their own
 * "Logistics" header rather than dangling as ungrouped fields.
 */
export function logisticsPreviewFields(
  askShirtSize: boolean,
  askFoodIntolerances: boolean,
  intolerances: IntoleranceOption[],
  shirtSizes: string[],
): TemplateField[] {
  const extra: TemplateField[] = [];
  if (askShirtSize) extra.push(shirtSizePreviewField(shirtSizes));
  if (askFoodIntolerances) {
    extra.push({
      key: "food_intolerances",
      label: {
        en: "Dietary restrictions",
        es: "Restricciones dietéticas",
        gl: "Restricións dietéticas",
      },
      kind: "multiselect",
      required: false,
      options: intolerances.map((i) => ({ value: String(i.id), label: i.label })),
      section_key: LOGISTICS_SECTION_KEY,
    });
    extra.push(FOOD_NOTES_PREVIEW_FIELD);
  }
  return extra;
}

/** Appends the synthetic Logistics section whenever any logistics field is
 *  present, so `groupFieldsBySections` can group them under a real header. */
export function withLogisticsSection(
  sections: FormSection[],
  hasLogisticsFields: boolean,
): FormSection[] {
  return hasLogisticsFields ? [...sections, LOGISTICS_SECTION] : sections;
}

// ── sections grouping (H11) ─────────────────────────────────────────────────

export interface FieldGroup {
  /** null = ungrouped fields, rendered with no header. */
  section: FormSection | null;
  fields: TemplateField[];
}

/**
 * Groups a flat field list under its sections, in section order, with any
 * fields whose `section_key` is unset or doesn't match a known section
 * leading as one ungrouped group — matching the builder's own layout, where
 * unassigned questions sit above the section blocks. Shared by the builder
 * preview and the applicant-facing form so both render sections identically.
 */
export function groupFieldsBySections(
  fields: TemplateField[],
  sections: FormSection[],
): FieldGroup[] {
  const knownKeys = new Set(sections.map((s) => s.key));
  const ungrouped = fields.filter((f) => !f.section_key || !knownKeys.has(f.section_key));
  const groups: FieldGroup[] = [{ section: null, fields: ungrouped }];
  for (const section of sections) {
    groups.push({ section, fields: fields.filter((f) => f.section_key === section.key) });
  }
  return groups.filter((g) => g.fields.length > 0);
}
