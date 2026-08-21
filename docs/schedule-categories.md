# Schedule categories (activity kinds)

A schedule item's category — *meal*, *workshop*, *talk*, *ceremony*,
*deadline*, … — is the same value everywhere: `schedule.type` in Postgres, the
`type` field of the schedule API, the category pill on the web run-of-show and
the mobile schedule, the reminder kinds in the inbox (H51), and the
`activities.category` of the scanner row mirrored off the item (H25, H26).

**All of it comes from one table: `packages/shared/src/activity-kinds.ts`.**
Nothing else declares a category, and four guardrails make sure nothing can
declare one on the side.

## Adding a category

1. **Add one entry** to `KINDS` in `packages/shared/src/activity-kinds.ts`:

   ```ts
   hike: { icon: "footprints", symbol: "figure.walk", scan: "activity" },
   ```

   - `icon` — a [lucide](https://lucide.dev) icon name for the web.
   - `symbol` — an SF Symbol name for the mobile app.
   - `scan` — `"meal"` gives the category meal semantics (always scannable,
     everyone entitled, repeats counted); anything else is `"activity"`.

2. **Add the two labels in all three locales.** The keys are *derived* from the
   id, so they are not free choices:

   | Key | File | Text |
   | --- | --- | --- |
   | `typeHike` | `packages/shared/locales/{es,gl,en}/common.json` | singular, e.g. "Hike" |
   | `kindHike` | `packages/shared/locales/{es,gl,en}/web.json` | plural, for reminder preferences, e.g. "Hikes" |

3. **Map the new icon name** in `KIND_ICONS`
   (`apps/web/src/app/(app)/schedule/schedule-model.ts`) and **add the Android
   alias** for the new SF Symbol in `ANDROID_SYMBOL_NAMES`
   (`apps/mobile/components/symbol.tsx`). Reusing an icon/symbol another
   category already declares needs neither step.

That's the whole change: the web schedule filter and form, the inbox reminder
kinds, the mobile schedule/filter/notification screens, the API's validation of
`schedule.type` and the mirrored scanner activity all read the registry.

## What stops the fronts from drifting

| Guardrail | Catches |
| --- | --- |
| `activityKindLabelKey` / `activityKindPluralKey` return template-literal types (`` `type${Capitalize<ActivityKind>}` ``) checked against each app's `MessageKey` | a category shipped before its `common`/`web` labels exist — web **and** mobile fail to typecheck |
| `KIND_ICONS: Record<ActivityKindIconName, LucideIcon>` | a new lucide icon name with no component mapped — web fails to typecheck |
| `ANDROID_SYMBOL_NAMES … satisfies Record<string, string> & Record<ActivityKindSymbolName, string>` | a new SF Symbol with no Android alias (it would render blank on Android) — mobile fails to typecheck |
| `pnpm check:copy` cross-checks every registry id against `common/type*` and `web/kind*` | a missing **locale** (es/gl/en) for a category, without needing a typecheck |

The API validates `schedule.type` against `ACTIVITY_KINDS` (`scheduleBody` in
`apps/api/src/modules/logistics/schemas.ts`), so an unknown category can't be
written at all. Reads stay tolerant: rows written before a category was retired
keep their raw value, and every label helper falls back
(`DEFAULT_ACTIVITY_KIND`, or the raw string for inbox reminder kinds).

## Meals are a `scan` flag, not a magic string

`isMealActivityKind` / `MEAL_ACTIVITY_KINDS` replace every hardcoded
`'meal'` comparison — including the SQL in `stats.ts` and `scanner-sync.ts`,
which filter with `a.category = ANY($1::text[])`. Marking a second category
`scan: "meal"` therefore gives it meal behaviour end to end (forced
`requires_scan`, the meals scanner list, offline meal batches, meal stats,
the meal-vs-activity pill on web and mobile) with no further code change.

## Retiring a category

Remove its entry and its four label strings. Existing rows keep the stored
value — they render through the fallbacks above — but the category disappears
from every picker and the API stops accepting it. If those rows should change
category, do it in a migration; nothing rewrites them automatically.
