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

## Follow-up: shirt-size list + builder layout (user-requested)

Two more rounds on the same surface, same session.

### Event-configurable shirt-size list

The shirt-size picker was hardcoded (`["XS","S","M","L","XL","XXL"]`) in six
places: `applications/service.ts` (API, the actual submit-time field/validation),
and five web spots — `my-applications/lib.ts` (participant form), `applications/[id]/shared.ts`
(builder preview), `claim-account/page.tsx` (invite claim), `settings/profile/page.tsx`
(self-edit), `users/[id]/overview-tab.tsx` (staff edit). Made `event_config.shirt_sizes`
(migration `0110`) the single source of truth:

- API: `GET /api/public/event` now returns `shirtSizes` (public — invite-claim
  and participant pages are unauthenticated/low-privilege contexts); `PUT /api/event`
  accepts and validates it (unique, 1–20 entries). `applications/service.ts`'s
  `enrichTemplate` reads it live instead of a hardcoded const, so the
  submit-time select field's options — and therefore validation — follow
  whatever is currently configured.
- Web: new `hooks/use-shirt-sizes.ts` fetches once with a same-as-DB-default
  fallback; all six consumers now call it instead of a local const.
- Settings UI: a `useFieldArray`-backed add/remove list. Originally added to
  the Invited-accounts tab; relocated to Settings → Libraries
  (`shirt-sizes-manager.tsx`) in the Event Settings restructuring that moved
  every shared reference catalogue to one place — see
  `docs/event-config-wallet.md`.
- Verified backend end-to-end via direct API calls (not just typecheck): set
  the list to `["S","M","L","3XL"]`, confirmed a submit with the now-removed
  `"XXL"` got `400 invalid option` and one with the new `"3XL"` succeeded.
  Verified in-browser that adding "3XL" in the settings tab immediately shows
  up in the profile self-edit picker.

### Builder layout pass (Questions card)

User feedback: no way to add a question from the bottom of a long list, and
the live-preview sidebar felt thin/unlabeled. Changes:

- Added a matching "Add question" button below the last question (and as the
  primary action in the empty state, previously absent there entirely).
- Lowered the breakpoint that shows the live-preview sidebar from `xl`
  (1280px) to `lg` (1024px) and rebalanced the split
  (`lg:grid-cols-[minmax(0,1.3fr)_minmax(22rem,1fr)]`, up from
  `xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]`), and gave the preview
  panel a visual identity of its own (`bg-muted/30 rounded-xl`, an "Live
  preview" label with an eye icon) instead of reading as a bare leftover
  column.
- That rebalancing exposed a **real, pre-existing regression risk**: the
  question editor's own "Applicant question"/"Kind" row used a *viewport*
  breakpoint (`sm:grid-cols-[minmax(0,1fr)_14rem]`) to decide when to go
  two-column, not the width of its own (now-narrower) column — at 1024px
  viewport width the label and input visibly overlapped. Fixed properly with
  a Tailwind v4 container query (`@container` on the editor column,
  `@lg:grid-cols-[...]` on the row) so it responds to the space it actually
  has, matching the pattern already used in `components/ui/card.tsx`.
  Verified at 1024px, 1440px, and 1600px viewports.

## Follow-up: named sections (H11, user-requested)

Grouping template fields under a named section (title + optional description),
similar to a typed hackathon platform's builder — but rendered as a neutral
bordered container per hackOS's own design system (no per-section color wash;
`Tone` colors stay reserved for status semantics) and with no icon picker
(title + description only).

- API: `applications.sections jsonb` (migration `0206`), an array of
  `{ key, title, description? }`. `templateFieldSchema` gained an optional
  `section_key` referencing a section. `createApplicationSchema`/
  `updateApplicationSchema` validate that every field's `section_key`
  resolves to a defined section (checkable only when both `template` and
  `sections` are present in the same request — a partial PATCH touching just
  one side can't be cross-validated without the DB row).
- Web: a `groupFieldsBySections()` helper (duplicated per-module, since types
  are declared locally per module convention — `applications/[id]/shared.ts`
  and `my-applications/lib.ts`) groups a flat field list by section, unassigned
  fields leading as one ungrouped group. Both the builder's live preview
  (`FormPreviewPanel`) and the applicant-facing form (`my-applications/[id]/page.tsx`)
  render section headers (title + description, no icon) above their fields
  using this same helper, so a form with no sections renders exactly as before.
  (The builder's own editing UI for assigning fields to sections was reworked
  further in the drag-and-drop follow-up below — see that entry for the
  current shape.)
- Verified end-to-end in a real browser: created a form, added a section
  ("Education info" + description), assigned a question to it, confirmed the
  live preview grouped it above the ungrouped shirt-size/dietary fields,
  saved, reloaded to confirm persistence, then opened the applicant-facing
  `/my-applications/:id` form and confirmed the same grouping rendered there.

## Follow-up: drag-and-drop builder, help text, logistics section (H11, user-requested)

Rework of the same builder, requested right after sections shipped: reorder
questions and sections by dragging, not just via the section dropdown; a
small optional hint line under a question (e.g. "we won't use this to call
you"); and the shirt-size/dietary fields grouped under their own "Logistics"
header instead of floating unlabeled at the end.

- **Drag-and-drop**: added `@dnd-kit/core`, `@dnd-kit/sortable`,
  `@dnd-kit/utilities` (no DnD library existed in the repo before). New
  `applications/[id]/questions-dnd.tsx` holds the dnd-kit wrappers (`DragHandle`,
  `SortableField`, `SortableSection`, `DroppableBlock`, `EmptyBlockHint`).
  `QuestionsCard` now renders one `DndContext` around the whole question list:
  fields nest visually inside their section's card (a `Block` model —
  `{ id, section, fields }`, "ungrouped" always first) instead of a flat list
  with a section dropdown; dragging a field into a different section's card
  reassigns its `section_key` live. Both the drag handle and the pre-existing
  up/down buttons remain — dragging is the fast path, the buttons are the
  keyboard/no-JS-drag-support fallback (confirmed with the user rather than
  removing either). Field/section identity for `useSortable` uses a
  client-only `_id` (`crypto.randomUUID()`), never sent to the API — `key` is
  unsafe as a drag id because it can transiently collide while a label is
  still being typed (the same reason the old flat list keyed its React nodes
  by array index instead of `field.key`).
- **Help text**: `templateFieldSchema`/`TemplateField` gained an optional
  `help_text` (i18n, like a section's description). Rendered under the field
  in `TemplateFieldControl` (shared by the applicant form and staff response
  editing) and in the builder's preview, via a new `LinkifiedText` component
  (`components/common/linkified-text.tsx`) that auto-links bare `https://` URLs
  in an otherwise-plain string — no HTML parsing, so there's no injection
  surface for a pasted hint like the HackUPC example ("tip: you can chose from
  here http://...").
- **Logistics as a section**: the shirt-size/dietary fields the server injects
  at submit time (`enrichTemplate`) are now tagged with a reserved
  `section_key` (`__logistics__`, double-underscore so it can't collide with
  an admin-authored section) and a synthetic `LOGISTICS_SECTION` gets appended
  to whatever sections a form has for rendering purposes only — never written
  to `applications.sections`. Same pattern duplicated in both client mirrors
  (`applications/[id]/shared.ts`'s `logisticsPreviewFields`/`withLogisticsSection`,
  `my-applications/lib.ts`'s `enrichTemplate`/`withLogisticsSection`) that
  already existed for previewing these fields before this change.
- Found and fixed a real ordering inconsistency while verifying in-browser:
  the builder's own edit layout put unassigned ("No section") fields first,
  but `groupFieldsBySections` put them last — a question left unsectioned
  would render at the top while editing and at the bottom for the applicant.
  Flipped `groupFieldsBySections` (both copies) to lead with the ungrouped
  group, matching the builder.
- Verified end-to-end in a real browser: added two questions and a section,
  pointer-dragged one question's handle from the ungrouped bucket onto the
  section's drop zone, confirmed its "Section" dropdown updated to match and
  the live preview re-grouped it live; typed help text into a question and
  watched it appear under the field in the live preview; saved, and confirmed
  it persisted after a reload. `pnpm --filter @hackos/web exec tsc`,
  `pnpm --filter @hackos/api exec tsc`, both test suites (93 API + 203 web),
  `pnpm check:copy`, and biome all clean.

### Follow-up: one-question-at-a-time card interaction

User asked for the card interaction itself to change, not just the section
grouping: one question expanded into a full editor at a time, everything
else showing its live-preview read-only, a left accent bar on the active
card, and a duplicate action.

- `FieldEditor` now has two render paths gated on a new `active: boolean`
  prop, driven by `activeFieldId` state in `QuestionsCard` (only one field
  editable at once — clicking a collapsed card, or "Add question", activates
  it; clicking the padding around the block list clears it). Collapsed:
  a button rendering `FieldPreviewRow` (the same component the live-preview
  sidebar already used) inside a `pointer-events-none` wrapper, so the
  disabled preview controls never intercept the activation click. Active:
  underline-style title input + compact type `Select` in one row, the
  `AnswerPreviewControl` (extracted from `FieldPreviewRow` so both the
  collapsed state and the active non-choice-kind body can render the same
  disabled control), `OptionsEditor` for choice kinds, and a footer —
  duplicate, delete, a `Separator`, then the Required switch — replacing the
  old always-visible top-row icon cluster.
- `OptionsEditor` restyled to match: a static radio-glyph, an underline
  input, and an X to remove, per option — translations/value still tucked in
  a `<details>` per option, unchanged functionally.
- Added `duplicateField()` (clone + regenerate a unique key via the existing
  `generatedFieldKey` helper, insert right after the original, activate the
  copy) — the one net-new capability, everything else was restyling.
- Bug found and fixed while verifying: the live-preview's multiselect/select
  option chips were keyed by `o.value`, which is empty for a freshly-added,
  not-yet-typed option — adding a second blank option produced a duplicate
  React key (`Encountered two children with the same key`, caught via the
  dev server log, not just the screenshot). Keyed by index instead, matching
  how `OptionsEditor` itself already keys its own option rows.
- Also made the option row's remove (X) button always visible instead of
  hover-only — hover-reveal has no equivalent on touch, and this is an admin
  tool, not a marketing surface where hover chrome is acceptable.
- Verified in a real browser: added a question, watched it expand active and
  collapse the previous one when adding a second; switched a question to
  "Single choice", added two options, typed one, confirmed the
  live preview showed the option chip and the duplicate-key warning was gone
  from the dev server log afterward.

### Follow-up: drag-and-drop, response validation, and answer-time polish

A further round of fixes and additions on top of the two follow-ups above,
driven by direct testing feedback (some via screenshots) after the
one-question-at-a-time interaction landed.

- Replaced the up/down-only reorder with real pointer drag via `@dnd-kit/core`
  + `@dnd-kit/sortable` (new dependency — nothing else in the repo did
  drag-and-drop). Both questions and sections carry a `DragHandle`; up/down
  buttons stay alongside the handle rather than being replaced by it, since
  the user wanted both. New `questions-dnd.tsx` holds the dnd-kit wiring
  (`SortableField`, `SortableSection`, `DroppableBlock`).
- Fixed two related bugs where a drag couldn't land in specific target zones:
  dragging a question to the very bottom of its own section, and dragging a
  section below the last existing section. Both had the same root cause —
  `DroppableBlock` had been made conditional on "block is empty" to avoid an
  earlier collision-ambiguity concern, which meant a non-empty block (or the
  space after the last section) had no droppable region past its last item.
  Fixed by keeping every block's `DroppableBlock` mounted unconditionally
  (empty or not) and adding a dedicated trailing `sections-end` droppable
  after the sections list, which `handleSectionDragEnd` special-cases as
  "move to the end" since there's no `over` section id to diff against there.
- Added `FIELD_KIND_ICON` (one lucide icon per `FieldKind`) to the type
  `Select`'s `SelectItem`s. Fixed a double-icon regression caught via
  screenshot — an icon had also been added to the `SelectTrigger` itself, but
  Radix's `SelectValue` already renders the selected item's full children
  (icon + label), so the trigger showed two icons side by side. The trigger
  render was reverted; the icon lives only on each `SelectItem`.
  Removed `file-url`'s `LinkIcon` entry along with the kind itself (below).
- Removed the AI-sounding "E.g.: ..." example text from the help-text
  placeholder; it's now just the field's own label ("Help text").
- Added a per-section "Add question" button that pre-assigns the new
  question's `section_key`, and removed the now-redundant "Section" `Select`
  from each question editor — drag plus this per-section button both already
  express section assignment, and having a third, easy-to-miss way to change
  it was pure clutter.
- Added a "Help text" toggle to the `FieldEditor` kebab menu (`DropdownMenu`,
  alongside the existing "Response validation" toggle): flips `field.help_text`
  between an empty i18n object and `undefined`.
- Rebuilt `ValidationEditor` as a category-driven validator UI instead of
  the previous flat min/max/pattern inputs. Text/textarea fields now pick a
  category first (Text / Length / Regular expression): Text shows a condition
  `Select` (Contains / Doesn't contain / Is an email / Is a URL) plus a value
  input only where the condition needs one; Length shows min *and* max length
  together (previously mutually exclusive in practice since there was no UI
  to set both); Regex is the old pattern input, unchanged. Multiselect fields
  get a single condition `Select` (At least / At most / Exactly N) driving
  `min_selected`/`max_selected` together instead of two separate raw number
  inputs. Number fields keep the existing min/max pair. `TextValidationCategory`
  is derived from which fields are already set (`text_condition` → "text",
  `pattern` → "regex", else "length"), and switching category clears the
  other category's fields so stale values can't linger and fire silently.
- Relaxed URL validation (`SIMPLE_URL_RE` in `service.ts`) so `https://` is
  optional — applicants no longer have to type a scheme for a field validated
  as "Is a URL" to accept it.
- Removed the `file-url` field kind entirely (schema, web types, kind icons,
  `FieldKind` unions, `TemplateFieldLike` rendering, and the `linkPlaceholder`/
  `fieldKindFileUrl` i18n keys): a plain text field with the "Is a URL"
  validation condition now covers the same case, and having two different
  ways to ask for a link was redundant once URL validation didn't require a
  manually-typed scheme.
- Added a `placeholder` (i18n) field to `TemplateField`, editable for typed
  kinds (text/textarea/number) in `FieldEditor` and rendered by
  `AnswerPreviewControl`/`TemplateFieldControl` wherever the field's answer
  control is shown, so admins can set example/hint text without needing a
  full help-text paragraph.
- Restored shirt size and food-intolerance visibility in review: the review
  modal (`review-modal.tsx`) now synthesizes read-only "Logistics" answer rows
  (shirt size, dietary restrictions, dietary notes) from the response's user
  data and groups them under a "Logistics" header alongside the form's own
  sections, plus an "Edit on the applicant's profile" link — deliberately
  *not* inline-editable here, since the dedicated edit-response endpoint this
  modal's edit mode uses intentionally excludes this data (a past-bug
  safeguard already documented in that endpoint). `getResponseDetail()` in
  `service.ts` was changed to return the *raw* template plus `sections`/
  `ask_shirt_size`/`ask_food_intolerances` instead of a server-enriched
  template, to match what `ResponsesTab`'s pathway already provided and avoid
  double-counting these fields once the client synthesizes them itself.
  The staff review list (both the `/applications/:id` review tab and a
  user's own `/users/:id` Application tab) now shows section headers purely
  as visual separation, with no change to how answers are scored or decided.
- Unified the question editor's field styling: the new Placeholder input had
  shipped with a boxed style while Title and Help text use an underline
  style; switched Placeholder to match. Locale-suffixed labels ("ES"/"GL")
  that appeared bare in the translations panel now carry their field's label
  as a prefix (e.g. "Applicant question (ES)", "Section title (ES)") instead
  of just the bare locale code, matching how "Help text (ES)" already read.
- Verified in a real browser end-to-end: dragged a question within and across
  sections including to the very end of a section (code-reviewed the
  drag-to-end/drag-below-last-section logic directly, since headless
  CDP-simulated pointer drags proved unreliable to script against dnd-kit);
  confirmed the "Link" kind no longer appears in the type dropdown; set a
  text field's validation to category "Text" / condition "Is a URL" and
  confirmed the condition-only editor (no value input) rendered correctly;
  submitted a response with a shirt size as a separate applicant account and
  confirmed the review modal grouped "EDU" (the form's own section) and
  "LOGISTICS" (shirt size + dietary rows) correctly with no duplicate fields,
  and that the "Edit on the applicant's profile" link was present.

### Follow-up: container styling cleanup

User feedback ("se ve algo extraño... parece generado por IA") pointed at
inconsistent box styling in the question editor — traced to several ad hoc
`rounded-*`/border combinations that never matched the app's actual `Surface`
primitive (`components/ui/surface.tsx`, 8px `rounded-surface`, border-only,
no shadow — see `docs/DESIGN.md` §2-3).

- `FieldEditor`'s collapsed and active cards were hand-rolled `rounded-lg
  border p-4` divs; switched both to the real `Surface` component. The active
  card also carried a `shadow-sm`, which `docs/DESIGN.md` explicitly rules
  out for inline grouping ("No shadow for inline grouping — border-only") —
  dropped.
- `ValidationEditor`'s three category boxes (text/multiselect/number) used
  `rounded-md border-dashed bg-muted/20 p-3` — a radius (6px) that doesn't
  match any surface token, a dashed border style that appears nowhere else in
  the app, and a background wash that made it read as a second nested card
  inside the already-bordered `FieldEditor` surface. Replaced with a plain
  `border-t pt-4` divider, since it's already inside a `Surface` and doesn't
  need one of its own.
- The live-preview panel's per-section field group (`form-preview.tsx`) used
  `rounded-xl`, visually clashing with the `rounded-lg` cards in the editor
  column right next to it. Matched to `rounded-lg`.
- Unified the "Translations and technical settings" `<details>` padding from
  `p-3` to `p-4`, matching its sibling `Surface` cards' padding instead of
  running a half-step tighter.
- Follow-up correction: the fixes above still left corners visibly mismatched
  within the same row — e.g. the question's Title input sat flush next to the
  Kind `Select`, but Title used an earlier custom underline style
  (`rounded-none border-0 border-b`) while `Select` used the app's real
  `Input`/`Select` default (`rounded-md`, full border, `shadow-xs` — see
  `components/ui/input.tsx`). That underline style was a deliberate look
  introduced by an earlier round of this same feature, but it directly
  conflicts with `docs/DESIGN.md`'s own Control token (6px radius, always
  bordered) that every other input/select in the app follows. Removed the
  underline override everywhere it had been applied — question
  title, placeholder, help text, section title, section description, and
  each option's label input — so they're plain boxed `Input`s like
  everything else, keeping only their font-size/weight modifiers.

### Follow-up: placeholder toggle, "Description" rename, layout width

- The placeholder-text input was always shown for typed kinds with no way to
  turn it off; changed it to the same optional pattern help text already
  used — `field.placeholder` starts `undefined`, a "Placeholder text" item in
  the kebab menu turns it on/off, and the input (plus its other-locale
  translations) only renders once enabled.
- Renamed "Help text" to "Description" throughout the field editor (input
  placeholder, aria-label, translations-panel label, kebab menu item) —
  reused the existing generic `descriptionLabel` i18n key rather than adding
  a new one, since the underlying field and behavior are unchanged, just the
  label admins see.
- Removed the builder's live-preview sidebar (the second column with its own
  locale switcher, sticky-positioned next to the question list) — the
  "Preview" button's modal already covers the same need on demand, and
  dropping the fixed sidebar lets the question editor use the full card
  width instead of being squeezed into `~1.3fr` of a two-column grid.
  Removed the now-dead `previewLocale` state, `FormPreviewPanel` import, and
  `livePreviewLabel` i18n key along with it — `FormPreviewPanel` itself stays
  in `form-preview.tsx`, still used by the preview modal.
