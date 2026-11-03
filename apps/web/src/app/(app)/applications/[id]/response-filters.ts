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

export type ScoreComparison = "gt" | "lt" | "eq";

/** H13/H14: compare the actual average, never treat an unscored response as zero. */
export function matchesScore(
  score: ResponseRow["avg_score"],
  comparison: ScoreComparison,
  threshold: number,
): boolean {
  if (score == null || score === "" || !Number.isFinite(threshold)) return false;
  const value = Number(score);
  if (!Number.isFinite(value)) return false;
  if (comparison === "gt") return value > threshold;
  if (comparison === "lt") return value < threshold;
  return value === threshold;
}

/** H13: the API only returns reviews the caller is allowed to read. */
export function matchesResponseSearch(
  row: Pick<ResponseRow, "name" | "email" | "reviews">,
  search: string,
): boolean {
  const query = search.trim().toLocaleLowerCase();
  return (
    !query ||
    [row.name, row.email, ...row.reviews.map((review) => review.notes)].some((value) =>
      value?.toLocaleLowerCase().includes(query),
    )
  );
}
