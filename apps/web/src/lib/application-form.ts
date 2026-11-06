import type { FormSection, TemplateField } from "@/lib/applications";
import type { I18nText } from "@/lib/types";

/** Locale tab order for every trilingual editor on this page. */
export const LOCALES = ["es", "en", "gl"] as const;

/** Minimal shape of a food-intolerance dictionary entry (public endpoint). */
interface IntoleranceOption {
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

const LOGISTICS_SECTION: FormSection = {
  key: LOGISTICS_SECTION_KEY,
  title: { en: "Logistics", es: "Logística", gl: "Loxística" },
};

function shirtSizeField(sizes: string[]): TemplateField {
  return {
    key: "shirt_size",
    label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
    kind: "select",
    required: true,
    options: sizes.map((s) => ({ value: s, label: { en: s, es: s, gl: s } })),
    section_key: LOGISTICS_SECTION_KEY,
  };
}

const FOOD_NOTES_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
  section_key: LOGISTICS_SECTION_KEY,
};

/** The dietary-restrictions multiselect plus its free-text notes field. */
function foodIntoleranceFields(intolerances: IntoleranceOption[]): TemplateField[] {
  return [
    {
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
    },
    FOOD_NOTES_FIELD,
  ];
}

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
  if (askShirtSize) extra.push(shirtSizeField(shirtSizes));
  if (askFoodIntolerances) extra.push(...foodIntoleranceFields(intolerances));
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

/**
 * Client mirror of the API's `enrichTemplate`: the public form endpoint serves
 * the raw template, so the applicant form shows the logistics fields from the
 * first render. The server re-enriches and validates on submit.
 */
export function enrichTemplate(
  askShirtSize: boolean,
  askFoodIntolerances: boolean,
  template: TemplateField[],
  intolerances: IntoleranceOption[],
  shirtSizes: string[],
): TemplateField[] {
  let out = template;
  if (askShirtSize && !out.some((f) => f.key === "shirt_size"))
    out = [...out, shirtSizeField(shirtSizes)];
  if (askFoodIntolerances && !out.some((f) => f.key === "food_intolerances"))
    out = [...out, ...foodIntoleranceFields(intolerances)];
  return out;
}
