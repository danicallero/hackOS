// Plain-text rendering and CSV download of one application response.

import { getFoodIntolerances } from "@/hooks/use-food-intolerances";
import { api } from "@/lib/api";
import type { ResponseRow, TemplateField } from "@/lib/applications";
import { exportCsv } from "@/lib/csv";
import { pickText, type Translate } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface LibraryNames {
  universities: Map<number, string>;
  degrees: Map<number, string>;
  intolerances: Map<number, string>;
}

/** Renders one field's value as plain text for the answers export — mirrors
 *  TemplateFieldControl's read-only display for kinds with an option lookup. */
function fieldValueText(
  field: TemplateField,
  value: unknown,
  lang: Language,
  t: Translate,
  libraryValues: LibraryNames,
): string {
  if (value == null || value === "") return "";
  switch (field.kind) {
    case "select": {
      const opt = field.options?.find((o) => o.value === value);
      return opt ? pickText(opt.label, lang) : String(value);
    }
    case "multiselect": {
      const values = Array.isArray(value) ? value : [];
      return values
        .map((v) => {
          const opt = field.options?.find((o) => o.value === v);
          if (opt) return pickText(opt.label, lang);
          if (field.key === "food_intolerances") {
            return libraryValues.intolerances.get(Number(v)) ?? String(v);
          }
          return String(v);
        })
        .join(", ");
    }
    case "checkbox":
      return value === true ? t("yesLabel") : t("noLabel");
    case "university":
    case "degree": {
      const id = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(id) || id <= 0) return String(value);
      return (
        (field.kind === "university"
          ? libraryValues.universities.get(id)
          : libraryValues.degrees.get(id)) ?? String(value)
      );
    }
    case "city": {
      if (typeof value !== "object") return String(value);
      const { city, province, country } = value as Record<string, unknown>;
      return [city, province, country]
        .filter((part) => typeof part === "string" && part)
        .join(", ");
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

/** Public-directory names for the ids in `ids`; an unreachable directory leaves
 *  the raw ids in the export rather than blocking the download. */
async function loadNames(
  path: string,
  key: "universities" | "degrees",
  ids: number[],
): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  try {
    const response = await api.get<Record<typeof key, Array<{ id: number; name: string }>>>(path, {
      query: { ids: ids.join(",") },
    });
    return new Map(response[key].map(({ id, name }) => [id, name]));
  } catch (error) {
    console.warn(`[review:export] could not resolve ${key}`, error);
    return new Map();
  }
}

async function loadIntoleranceNames(lang: Language): Promise<Map<number, string>> {
  try {
    const intolerances = await getFoodIntolerances();
    return new Map(intolerances.map((item) => [item.id, pickText(item.label, lang)]));
  } catch (error) {
    console.warn("[review:export] could not resolve food intolerances", error);
    return new Map();
  }
}

/** Downloads one response as a single wide CSV row, matching the application
 * export and user-roster convention: fields are columns and people are rows. */
export async function exportAnswers(
  response: ResponseRow,
  answerFields: TemplateField[],
  answerValues: Record<string, unknown>,
  lang: Language,
  t: Translate,
): Promise<void> {
  const idsFor = (kind: "university" | "degree") => [
    ...new Set(
      answerFields.flatMap((field) => {
        if (field.kind !== kind) return [];
        const id = Number(answerValues[field.key]);
        return Number.isInteger(id) && id > 0 ? [id] : [];
      }),
    ),
  ];
  const [universities, degrees, intolerances] = await Promise.all([
    loadNames("/api/public/universities", "universities", idsFor("university")),
    loadNames("/api/public/degrees", "degrees", idsFor("degree")),
    loadIntoleranceNames(lang),
  ]);
  const libraryValues = { universities, degrees, intolerances };
  exportCsv(`${(response.name ?? response.email).replace(/[^a-z0-9]+/gi, "-")}-answers.csv`, [
    ["Name", "Last name", "Email", ...answerFields.map((field) => pickText(field.label, lang))],
    [
      response.first_name ?? response.name ?? "",
      response.last_name ?? "",
      response.email,
      ...answerFields.map((field) => {
        const value = fieldValueText(field, answerValues[field.key], lang, t, libraryValues);
        return field.key === "food_intolerances"
          ? [value, answerValues.food_intolerance_notes].filter(Boolean).join(", ")
          : value;
      }),
    ],
  ]);
}
