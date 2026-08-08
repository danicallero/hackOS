# Application form builder UX audit (H11, H12)

Status: implementation complete; verified by browser screenshots
Scope: `apps/web/src/app/(app)/applications` create flow + `[id]` builder
(Form settings + Questions cards, preview, Overview tab)

## Context

Follow-up audit after adding the per-form `ask_shirt_size` /
`ask_food_intolerances` toggles (replacing the hardcoded participant/mentor
allowlist). Conducted by driving the real app in a browser (create → toggle
logistics → add a question → preview) rather than reading code in isolation,
then confirming each finding against the source.

## Findings and fix plan

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | 🔴 High | `FormPreviewPanel`/`FormPreviewModal` (`[id]/form-preview.tsx`) only render the custom `fields` array — never the shirt-size/dietary fields the server injects when the logistics toggles are on. Toggle it on, hit Preview, see nothing. | Fetch the food-intolerance dictionary once in `QuestionsCard`; append synthetic preview-only fields (mirroring `service.ts`'s `SHIRT_SIZE_FIELD`/`FOOD_NOTES_FIELD`) when `form.ask_shirt_size`/`form.ask_food_intolerances` are true; pass through to the preview components. |
| 2 | 🟡 Medium | The "New application form" creation modal never mentions shirt/dietary. They're silently pre-set based on person type and only visible later, scrolled down in the Form tab. | Add the same two switches to the creation modal, pre-checked to match today's silent default, so the decision is visible and editable at creation time. |
| 3 | 🟡 Medium | No unsaved-changes protection. Add a question, navigate away, it's gone — no warning. `settings/event/page.tsx` already has this pattern (`useUnsavedChangesGuard` + per-tab `onDirtyChange`); the builder doesn't. | Thread the same `onDirtyChange`/aggregate-guard pattern through `MetadataCard`, `QuestionsCard`, and `applications/[id]/page.tsx`. |
| 4 | 🟡 Medium | Form settings and Questions are separate cards with separate Save buttons and separate `Saved`/`Unsaved` badges — easy to save one and forget the other, no aggregate signal. | Once #3's dirty-state plumbing exists, surface a small aggregate "unsaved changes" indicator near the page header. **Not** merging the two PATCH flows into one save action — bigger, riskier scope, explicitly deferred. |
| 5 | 🟢 Low | "Ask for t-shirt size" always requires an answer at submit; "Ask for dietary restrictions" never does. Explained in the description text, not visible in the layout. | Small "Required at submit" badge next to the shirt-size toggle label. |
| 6 | 🟢 Low | The Overview tab (visible to review/decide-only staff without `applications:manage`) shows Type/Status/Questions/Capacity but nothing about the logistics toggles. | Add two fields to the Overview `dl`. |

## Implementation record

- #1 — `[id]/shared.ts` gained `logisticsPreviewFields()`, mirroring the
  server's `enrichTemplate`. `QuestionsCard` fetches `/api/public/food-intolerances`
  once and builds `previewFields = [...fields, ...logisticsPreviewFields(...)]`,
  passed to both `FormPreviewModal` and the desktop sidebar `FormPreviewPanel`
  (previously only `fields`). The Preview button's `disabled` check now uses
  `previewFields.length` too, so it's usable even on a form with zero custom
  questions but a logistics toggle on.
- #2 — `applications/page.tsx`'s create modal gained the same two `ask_shirt_size`/
  `ask_food_intolerances` switches as the builder. Changing Person Type
  re-suggests the defaults (participant/mentor on, else off) via
  `form.setValue`, still fully editable before submit.
- #3 — `MetadataCard` and `QuestionsCard` both take an `onDirtyChange` prop
  (react-hook-form's `isDirty` / the questions card's own `saveState !== "saved"`).
  `applications/[id]/page.tsx` aggregates both into one `builderDirty` flag,
  calls `useUnsavedChangesGuard(builderDirty)` (covers browser close/reload and
  any in-app link click), and wraps the tab `Tabs onValueChange` in a
  `changeTab` that runs `confirmDiscardUnsavedChanges` before leaving the
  Form tab while dirty — same pattern as `settings/event/page.tsx`.
- #4 — `PageHeader`'s `state` cluster shows a `<SaveStatus state="unsaved" />`
  next to the type/window badges whenever `builderDirty` is true, visible
  regardless of which card or tab is on screen. The two PATCH flows/Save
  buttons stay separate, as scoped.
- #5 — A neutral `StatusBadge` reading "Required at submit" sits next to the
  "Ask for t-shirt size" label in both the builder (`metadata-card.tsx`) and
  the create modal (`page.tsx`); "Ask for dietary restrictions" has none,
  making the asymmetry visible without reading the description text.
- #6 — The Overview `dl` gained "Ask for t-shirt size" / "Ask for dietary
  restrictions" Yes/No fields, visible to any tab holder (review/decide-only
  staff included).
- Bug found while verifying #1: `form-preview.tsx`'s multiselect renderer
  called `t("chooseAnyHint")`, a key that didn't exist anywhere in `i18n.ts` —
  it silently rendered the literal string `chooseAnyHint` in the UI. Added the
  missing trilingual key and gated the hint on `opts.length > 0` (it no longer
  shows next to "No options defined").

## Verification

- [x] `pnpm typecheck` (web) — clean after every fix.
- [x] `pnpm --filter @hackos/web exec biome check --write <changed files>` —
      formatting only, no lint errors.
- [x] `pnpm check:copy` — all new i18n entries have es/gl/en, no leaks.
- [x] `pnpm --filter @hackos/web exec vitest run` — 31 files / 203 tests, all
      green.
- [x] Manual browser pass (screenshots below): created a sponsor form (which
      defaults both logistics toggles off), turned both on and saw the
      "Required at submit" badge; Preview showed T-shirt size (required,
      options XS–XXL) plus Dietary restrictions/notes even with zero custom
      questions; the desktop live-preview sidebar matched; added a custom
      question, then tried switching to the Overview tab — got "There are
      unsaved changes in this section. Leave anyway?" and stayed on the Form
      tab after cancelling; the page header showed an aggregate "Unsaved
      changes" indicator the whole time; the Overview tab (no edits) showed
      "Ask for t-shirt size: Yes" / "Ask for dietary restrictions: Yes".
