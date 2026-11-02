import type { ResponseRow } from "@/lib/applications";

/** H13: multiselect membership is exact; false and zero are real answers. */
export function answerValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(answerValues);
  if (value == null || value === "") return [];
  if (typeof value === "object") {
    const location = value as Record<string, unknown>;
    return [
      [location.city, location.province, location.country]
        .filter((part) => typeof part === "string" && part.trim())
        .join(", "),
    ].filter(Boolean);
  }
  return [String(value)];
}

/** H12/H13: notes alone also require dietary planning. */
export function hasDietaryRestrictions(
  row: Pick<ResponseRow, "food_intolerances" | "food_intolerance_notes">,
): boolean {
  return (row.food_intolerances?.length ?? 0) > 0 || Boolean(row.food_intolerance_notes?.trim());
}
