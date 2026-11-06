import { isMealActivityKind, MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";

/**
 * The single definition of a "scannable" activity (H25 meals, H26 `requires_scan`):
 * a meal-kind category or an activity flagged `requires_scan`. Every SQL listing and the
 * scan guard derive from here, so a new scan kind is a one-file change.
 */

/** SQL predicate over `alias`; `categoriesParam` is the placeholder number bound to `scannableCategoriesParam()`. */
export function scannableActivitySql(alias = "a", categoriesParam = 1): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error(`Invalid SQL alias: ${alias}`);
  return `(${alias}.category = ANY($${categoriesParam}::text[]) OR ${alias}.requires_scan = true)`;
}

/** Value bound to the `categoriesParam` placeholder of `scannableActivitySql`. */
export function scannableCategoriesParam(): string[] {
  return [...MEAL_ACTIVITY_KINDS];
}

/** JS twin of `scannableActivitySql`, for a single already-loaded row. */
export function isScannableActivity(activity: {
  category: string;
  requires_scan: boolean;
}): boolean {
  return isMealActivityKind(activity.category) || Boolean(activity.requires_scan);
}
