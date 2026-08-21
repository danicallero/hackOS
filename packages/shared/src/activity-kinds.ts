/**
 * Single source of truth for schedule/activity categories (H26, H48, H51).
 *
 * **Adding a category is one entry here plus three translations.** Every
 * surface derives from this table — the web schedule (labels, filters, form),
 * the inbox reminder kinds, the mobile schedule/filter/notification screens,
 * the scanner activity rows mirrored off a schedule item, and the API's
 * validation of `schedule.type` — so nothing can drift out of sync:
 *
 * - the two i18n keys are *derived* from the id (`type<Pascal>` in
 *   common.json, `kind<Pascal>` in web.json) and typed as template literals,
 *   so the apps fail to typecheck until both keys exist, and
 *   `pnpm check:copy` fails until all three locales do;
 * - `icon` is a lucide name the web maps exhaustively to a component
 *   (`Record<ActivityKindIconName, …>` — a new name breaks the build until
 *   it's mapped), `symbol` is the SF Symbol the mobile app renders (a mobile
 *   test asserts it also has an Android fallback in components/symbol.tsx);
 * - `scan: "meal"` carries the meal semantics (always scannable, repeat
 *   counting, meal stats) instead of hardcoding `'meal'` in SQL.
 */

export interface ActivityKindDefinition {
  /** lucide-react icon name — see apps/web/src/app/(app)/schedule/schedule-model.ts. */
  readonly icon: string;
  /** SF Symbol name — needs an Android alias in apps/mobile/components/symbol.tsx. */
  readonly symbol: string;
  /**
   * Which scanner bucket an activity mirrored off this kind lands in.
   * `"meal"` means meal semantics: scannable without opting in, everyone is
   * entitled, repeats are counted (H25).
   */
  readonly scan: "meal" | "activity";
}

const KINDS = {
  activity: { icon: "sparkles", symbol: "sparkles", scan: "activity" },
  meal: { icon: "utensils", symbol: "fork.knife", scan: "meal" },
  workshop: { icon: "mic", symbol: "mic", scan: "activity" },
  talk: { icon: "mic", symbol: "mic", scan: "activity" },
  ceremony: { icon: "party-popper", symbol: "party.popper", scan: "activity" },
  deadline: { icon: "flag", symbol: "flag", scan: "activity" },
  other: { icon: "calendar-days", symbol: "calendar", scan: "activity" },
} as const satisfies Record<string, ActivityKindDefinition>;

export type ActivityKind = keyof typeof KINDS;

/** Every lucide icon name the registry references (web maps these exhaustively). */
export type ActivityKindIconName = (typeof KINDS)[ActivityKind]["icon"];
/** Every SF Symbol name the registry references (mobile renders these directly). */
export type ActivityKindSymbolName = (typeof KINDS)[ActivityKind]["symbol"];

/** Singular label key, resolved from common.json (`typeMeal`, `typeWorkshop`, …). */
export type ActivityKindLabelKey = `type${Capitalize<ActivityKind>}`;
/** Plural label key for reminder preferences, resolved from web.json (`kindMeals`, …). */
export type ActivityKindPluralKey = `kind${Capitalize<ActivityKind>}`;

/** Display/selection order — the order of the entries above. */
export const ACTIVITY_KINDS = Object.keys(KINDS) as readonly ActivityKind[];

/** The kind used when an item has no type, or one this build doesn't know. */
export const DEFAULT_ACTIVITY_KIND: ActivityKind = "activity";

/** Kind ids with meal semantics — use instead of hardcoding `'meal'`. */
export const MEAL_ACTIVITY_KINDS = ACTIVITY_KINDS.filter(
  (kind) => KINDS[kind].scan === "meal",
) as readonly ActivityKind[];

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && value in KINDS;
}

/** The definition for a kind, with literal `icon`/`symbol` types preserved. */
export function activityKind<K extends ActivityKind>(kind: K): (typeof KINDS)[K] {
  return KINDS[kind];
}

/** Narrow a stored `schedule.type` (free text on older rows) to a known kind. */
export function toActivityKind(value: string | null | undefined): ActivityKind | null {
  return isActivityKind(value) ? value : null;
}

/** True for kinds whose activities are meals: always scannable, repeats counted (H25). */
export function isMealActivityKind(value: string | null | undefined): boolean {
  return isActivityKind(value) && KINDS[value].scan === "meal";
}

function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}

/** i18n key for the singular label ("Meal"). Typed so a missing key fails the build. */
export function activityKindLabelKey(kind: ActivityKind): ActivityKindLabelKey {
  return `type${capitalize(kind)}`;
}

/** i18n key for the plural label ("Meals") used by reminder preferences (H51). */
export function activityKindPluralKey(kind: ActivityKind): ActivityKindPluralKey {
  return `kind${capitalize(kind)}`;
}
