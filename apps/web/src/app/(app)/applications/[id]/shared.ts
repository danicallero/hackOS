/**
 * Constants shared across the application-detail route's files (H11-H14).
 */

import type { I18nText } from "@hackos/shared/questions";
import type { TemplateField } from "../lib";

/** Locale tab order for every trilingual editor on this page. */
export const LOCALES = ["es", "en", "gl"] as const;

/** A blank trilingual value — every i18n field must carry all three (plan/07 §2). */
export const EMPTY_I18N: I18nText = { en: "", es: "", gl: "" };

/** Minimal shape of a food-intolerance dictionary entry (public endpoint). */
export interface IntoleranceOption {
  id: number;
  label: I18nText;
}

function shirtSizePreviewField(sizes: string[]): TemplateField {
  return {
    key: "shirt_size",
    label: { en: "T-shirt size", es: "Talla de camiseta", gl: "Talla de camiseta" },
    kind: "select",
    required: true,
    options: sizes.map((s) => ({ value: s, label: { en: s, es: s, gl: s } })),
  };
}

const FOOD_NOTES_PREVIEW_FIELD: TemplateField = {
  key: "food_intolerance_notes",
  label: { en: "Dietary notes", es: "Notas dietéticas", gl: "Notas dietéticas" },
  kind: "textarea",
  required: false,
};

/**
 * The shirt-size/dietary fields the server appends to the template at submit
 * time (mirrors `enrichTemplate` in `apps/api/.../applications/service.ts`),
 * so the builder's preview shows exactly what an applicant will see instead
 * of silently omitting logistics fields toggled on in Form settings.
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
    });
    extra.push(FOOD_NOTES_PREVIEW_FIELD);
  }
  return extra;
}
