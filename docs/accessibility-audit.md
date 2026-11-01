# Web accessibility audit

Findings, fixes, evidence and limits of the 2026-11-01 accessibility audit of
the hackOS web app. This is a record of what was checked and changed, not a
conformance statement: see [Limitations](#6-limitations). The rules the fixes
follow live in [DESIGN.md §9](./DESIGN.md#9-accessibility); how to run the
browser suite is in [ui-testing.md](./ui-testing.md).

| Section | What it covers |
|---|---|
| [1. Scope and method](#1-scope-and-method) | What was audited and how |
| [2. Findings](#2-findings) | Fixed defects by WCAG principle, with before/after and user impact |
| [3. Safari: Tab skips links](#3-safari-tab-skips-links) | Platform behaviour, not a defect |
| [4. Route coverage](#4-route-coverage) | Which of the 72 routes were verified, and how deeply |
| [5. Regression suite](#5-regression-suite) | Specs, commands, assertions |
| [6. Limitations](#6-limitations) | What this audit does not establish |
| [7. Maintenance](#7-maintenance) | Keeping this document true |

## 1. Scope and method

- **Scope**: `apps/web` only. Mobile (`apps/mobile`) and TV surfaces are out of
  scope.
- **Rendered axe-core scans**: 14 representative routes, each in light and dark
  theme (28 scans), against deterministic API fixtures. Zero axe violations is
  the pass condition; `incomplete` results are attached to each test and were
  reviewed by hand, not auto-passed.
- **Reflow**: 320 px viewport with root text at 200 %, on four routes. Besides
  document width, every visible link, button and field is checked to lie inside
  the viewport, because `overflow-x-clip` had hidden clipped controls from a
  width-only check.
- **Keyboard flows**: Tab, Shift+Tab, arrows, Enter, Space and Escape through
  the shell, public sections, overlays, menus, pickers, toasts and the
  route-specific widgets, in Chromium, Firefox and WebKit.
- **Rendered contrast**: colours were measured from rendered pixels rather than
  read from tokens.
- **Source review**: every `page.tsx` was triaged statically (control names,
  label associations, roles, click/drag handlers, headings, live regions,
  motion). Shell, public, UI-primitive, common-component and auth code were
  reviewed in full.

Severity: **HIGH** blocked a task or failed a hard criterion; **MEDIUM**
meaningfully impaired operation; **LOW** isolated polish. Severity was assigned
during this audit from the code change and its user impact.

## 2. Findings

The single `main` landmark, the app-shell skip link, the named primary
`nav`, global reduced motion and 24/44 px targets landed separately on
`staging` (#1172–#1184) while this audit ran; this branch was merged onto
them and its overlapping fixes dropped, so they are not listed below.

Every row is fixed in the working tree. Locations are the current line of the
fixed code; "before" is recoverable from `git diff`. Story references are the
ones the code comments carry (H49/H55 shell and public navigation; H13/H21
overlays).

### 2.1 Perceivable

| Sev | Location | Before | After | User impact |
|---|---|---|---|---|
| HIGH | `apps/web/src/styles/theme.css:93`, `:160` | `--input` equalled the decorative `--border`: field boundaries measured 1.56:1 (light, rgb 201,202,214 on 250,250,250) and 1.41:1 (dark, rgb 41,45,55 on 11,13,20) | `--input` uses the outline-button border: ≥3:1 (light rgb 102,105,142 on 250,250,250; dark rgb 154,155,158 on 11,13,20) | Low-vision users can see where every input, select, textarea, checkbox and switch begins and ends |
| HIGH | `apps/web/src/app/(app)/logistics/stats/stats-chart.tsx:183` | Exact values only in `sr-only` text; ECharts legend filtering and pagination pointer-only | Visible native disclosure with every exact value; native labelled checkboxes mirror the legend and stay in sync with it | Sighted keyboard users can read exact numbers and filter every series |
| MEDIUM | `apps/web/src/app/(auth)/login/page.tsx:127` (also `signup`, `forgot-password`, `reset-password`, `claim-account`, `verify-email`) | Page title was a card-title `div`: no `h1` | Real `<h1>` on every auth state | Screen-reader users get a page heading and heading navigation |
| MEDIUM | `apps/web/src/components/common/data-table.tsx:363` | Row-actions column header was empty | Header carries a `sr-only` "Actions" | Table cell actions have a column name |
| MEDIUM | `apps/web/src/app/(app)/inbox/page.tsx:21` and `inbox/inbox-tabs.tsx` | At 320 px and 200 % text, Preferences ended at x 415 and Add reminder at x 338 (viewport 320) | Tab triggers wrap; button text grows inside the available width | Controls are fully visible instead of clipped |
| MEDIUM | `apps/web/src/components/layout/public-top-bar.tsx:62`, `:68` | Fixed-height header; at narrow width or enlarged text, Login/language/theme overflowed (x 385/487/559 at 320 px) | Header wraps (`min-h-16`, `flex-wrap`); brand and action groups shrink | Public pages stay operable at narrow width and large text |
| MEDIUM | `apps/web/src/app/(auth)/login/page.tsx:185` | Password label and "forgot" link on one non-wrapping row; clipped at 320 px with 200 % text | Row wraps (`flex-wrap`, row/column gaps) | Login stays usable at large text |
| LOW | `apps/web/src/app/(app)/people/company-collection.tsx:75` | Sponsor progress ring always animated | Reduced-motion override | Respects `prefers-reduced-motion` |

### 2.2 Operable

| Sev | Location | Before | After | User impact |
|---|---|---|---|---|
| HIGH | `apps/web/src/lib/toast.ts:61`, `:64`, `:223` | Error toasts dismissed after 5 s, action toasts after 6–8 s | Error and action toasts persist (`duration: null`) until dismissed or acted on; explicit durations still win | Slower readers and keyboard/switch users no longer lose an error or an Undo before reaching it |
| HIGH | `apps/web/src/components/ui/sileo.tsx:82`, `patches/sileo@0.1.5.patch` | Sileo's toast root was a `<button>` containing the action link and a `role="button"` span: nested interactive content | Root is a `div`; Close and action are independent native buttons/links; focus or blur keeps the toast expanded | Valid, separately focusable Close and action controls; no swallowed Enter/Space |
| HIGH | `apps/web/src/components/ui/use-focus-restore.ts:8`, `dialog.tsx:79`, `sheet.tsx:65`, `alert-modal.tsx:49` | Controlled editors open without a Radix trigger; on close, focus fell to `body`. Menu-item openers vanish on selection | Hook records the opener, falls back to the owning menu button or a sibling, and does not steal focus the user already moved elsewhere | Closing a dialog or panel returns keyboard users to where they were |
| MEDIUM | `apps/web/src/components/layout/route-focus.tsx:8`, `providers.tsx:40` | Client-side navigation left focus on the old link | Focus moves to `#main-content` after forward navigation; initial load, hash links and Back/Forward scroll restoration are untouched | Screen-reader users hear the new page; keyboard users start at its top |
| MEDIUM | `apps/web/src/components/layout/app-sidebar.tsx:138`, `:343` | Mobile sheet stayed open after choosing a destination | Sheet closes on navigation | Focus is not left in a covered menu |
| MEDIUM | `apps/web/src/components/layout/app-sidebar.tsx:223`, `:419` | Active workspace could not be collapsed; in the icon rail and mobile sheet the disclosure state hid children | Rail and mobile sheet list every destination (`alwaysOpen`); the expanded sidebar lets the active workspace collapse and reopens it on navigation | Every Access and audit child is reachable with Tab in each sidebar mode (see [§3](#3-safari-tab-skips-links) for Safari) |
| MEDIUM | `apps/web/src/app/globals.css:463`, `public-top-bar.tsx:41` | Section anchors and the main target scrolled under the sticky public header | Header height is measured into `--public-header-height`; anchors use it as `scroll-margin-top`; headings show a focus ring | Jump links land on unobscured, focused headings |
| MEDIUM | `apps/web/src/components/common/entity-combobox.tsx:117`, `degree-picker.tsx:123`, `multi-select.tsx:212`, `university-picker.tsx:279`, `user-picker.tsx:199` | Pickers opened by click/Enter only; trigger announced `aria-haspopup="listbox"` for a popover | ArrowDown/ArrowUp open the picker; popup role is `dialog`, matching the popover that holds search and list | Keyboard users get the expected combobox opening key and an accurate role |
| MEDIUM | `apps/web/src/components/common/datetime-input.tsx:206` | Clear button had `tabIndex={-1}` | Clear button is in the Tab order | Keyboard users can clear a date/time |
| MEDIUM | `apps/web/src/components/ui/dialog.tsx:52`, `sheet.tsx:42`, `select.tsx:101`, `popover.tsx:62`, `dropdown-menu.tsx:90`, `tooltip.tsx:45` | Overlays kept 0.15–0.3 s enter/exit animations under `prefers-reduced-motion: reduce` (measured: dialog 0.2 s, sheet 0.3 s, select 0.15 s) | `motion-reduce` removes animation and transition on all six primitives | Motion-sensitive users see overlays without movement |
| MEDIUM | `apps/web/src/components/ui/input.tsx:17`, `textarea.tsx:10`, `select.tsx:69`, `checkbox.tsx:17`, `switch.tsx:20` | Focus indication relied on border/shadow colour, which forced-colors mode removes | `forced-colors:focus-visible` solid outline | Windows High Contrast users see focus on fields and toggles |
| LOW | `apps/web/src/components/ui/tabs.tsx:61` | Focusable tab panel had `outline-none` | Visible `focus-visible` outline | Focus on a tab panel is visible |
| MEDIUM | `apps/web/src/app/(app)/schedule/schedule-cells.tsx:227` | Inline text/time inputs unnamed; empty notes trigger showed only an em dash | Localized field label supplied by `ActivityRow`; triggers expose field plus value | Location, notes, start and end are identifiable by screen-reader and voice users |
| MEDIUM | `apps/web/src/app/(app)/users/invite-dialog.tsx:364` | Unnamed radios; a fake tablist of ordinary buttons; unnamed limit, URL and expiry | Native radio groups, pressed-state method buttons in a fieldset, named fields | Arrow keys change radios; method state and field purpose are announced |

### 2.3 Understandable

| Sev | Location | Before | After | User impact |
|---|---|---|---|---|
| MEDIUM | `apps/web/src/components/common/question-field.tsx:54`, `:66` | Fixed `question-<key>` ids (duplicates when a question renders twice); description, lock note and required state not tied to the control; asterisk was the only required cue | `useId` ids; `fieldset` labelled by the question; `aria-describedby` for description and lock; `aria-required`; multi-choice/scale announce "required" in text | Forms state what each question is, what it needs and why it is locked |
| MEDIUM | `apps/web/src/components/common/datetime-input.tsx:196`, `duration-input.tsx:119`, `scale-buttons.tsx:20` | Description, invalid and required state not forwarded to the inner time/duration/scale controls | Forwarded `aria-describedby`, `aria-invalid`, `aria-required`, `aria-labelledby` | Validation messages reach the control that failed |
| MEDIUM | `apps/web/src/app/(auth)/forgot-password/page.tsx:38`, `signup/page.tsx:89`, `claim-account/page.tsx:101` | After submit the form was replaced and focus was lost | Focus moves to the confirmation `h1` | The result of submitting is announced |
| MEDIUM | `apps/web/src/components/common/language-select.tsx:24` | Button named only "Language", while showing the current code | Name includes the visible code, e.g. "Language: EN" | Voice-control users can say what they see (WCAG label in name) |
| MEDIUM | `apps/web/src/app/(app)/inbox/inbox-tabs.tsx:622` | Channel name omitted the visible channel text; reminder name omitted visible "Turn off"/"Retry" | Name includes the visible text plus category/reminder context | Voice-control users can activate by visible text |
| MEDIUM | `apps/web/src/components/common/file-upload-field.tsx:148` | Upload error state was lost when `aria-invalid` was passed; hidden file input was focusable | Upload error forces `aria-invalid`; hidden input is `tabIndex={-1}` | Failed uploads are announced; no invisible tab stop |
| MEDIUM | `apps/web/src/app/(app)/schedule/schedule-cells.tsx:767`, `schedule-form-modal.tsx:736` | Owner free-text input named only by placeholder | Persistent localized name | Name remains after typing |
| MEDIUM | `apps/web/src/app/(app)/schedule/schedule-cells.tsx:146`, `:396`, `:482`, `:625`; `schedule-activity-row.tsx:410` | Visibility, type, audience, publish-time and activity triggers were named only "Edit <field>" / "Edit item", hiding the visible value (found once the axe fixture had a real activity) | Buttons keep a visually hidden "Edit <field>:" prefix before the visible value; the type select (a combobox, which takes no name from content) carries the value in its label | Screen-reader users hear the current value; voice-control users can say what they see |
| MEDIUM | `apps/web/src/app/(app)/permissions/grant-rules-overview.tsx:99`, `permissions/role-editor.tsx:353` | Search fields had no programmatic label | Localized `aria-label` | Search is identifiable |
| MEDIUM | `apps/web/src/app/(app)/sponsor-faq/page.tsx:157` | Block-kind select unlabelled | Existing localized "Kind" label | Block type identifiable |
| MEDIUM | `apps/web/src/components/forms/questions-card.tsx:1844` | Validation type, text condition and select-count labels had no `for`/`id` link | Unique matching ids | Builder validation controls are named; clicking a label focuses it |

### 2.4 Robust

| Sev | Location | Before | After | User impact |
|---|---|---|---|---|
| MEDIUM | `apps/web/src/components/ui/command.tsx:25`, `:55` | `cmdk` root unnamed; dialog title/description sat outside `DialogContent` | Root gets a label; title and description move inside the content | Command palette is named and its dialog is correctly described |
| LOW | `apps/web/src/components/common/page-toolbar.tsx:10` | Labelled `section` used as a toolbar group | `fieldset` with `min-w-0` | Group is announced as a labelled group without a stray region |
| MEDIUM | `apps/web/src/components/ui/sileo.tsx:143` | The patched toast viewport (now server-rendered so its live region exists before the first toast) rendered `data-theme` from an unresolved theme on the server: a hydration mismatch on every page | Server and first client render use the default theme, then follow the resolved one | No hydration error; the polite live region is stable from first paint |
| LOW | `apps/web/src/components/common/password-input.tsx:28` | Reveal button stayed enabled on a disabled field | Disabled with the field | No actionable control inside a disabled field |

## 3. Safari: Tab skips links

On macOS, Safari does not put links on the Tab sequence unless **Settings →
Advanced → "Press Tab to highlight each item on a webpage"** is on (off by
default). With it off, Tab skips sidebar and landing-page anchors, so Access
and audit children and section links looked unreachable. **Option-Tab** moves
through every item. This is platform behaviour: the links are native `<a>`
elements and were **not** replaced with fake buttons; Chromium, Firefox and
Safari with the setting on reach them with Tab. Source:
[Apple, Safari User Guide](https://support.apple.com/en-lamr/guide/safari/cpsh003/mac).
The WebKit runs in this suite use Playwright's WebKit, which does not apply
the Safari preference.

## 4. Route coverage

72 `page.tsx` entrypoints exist (54 app, 2 popup, 7 public, 8 auth, 1 root).
Most are source triage only.

Legend: **R** targeted real-browser fixture flow; **D** detailed source
inspection of the route and its domain widgets; **S** automated source triage
only, no rendered assertion; **X** owned by shell/auth/public work, covered by
the shell, axe and reflow specs rather than a per-route review. **Axe** marks
the 13 routes among the 14 scanned scenarios (`/inbox?tab=preferences` is a
second scenario of `/inbox`). A D, S or X entry is never a runtime pass on its
own.

| Coverage | Routes | Meaning |
|---|---|---|
| R + D | 4 | `/logistics/stats`, `/schedule`, `/settings/event` (project-builder tab), `/users/invites` |
| D | 6 | `/judging`, `/people`, `/permissions`, `/permissions/[roleId]`, `/queue/queues/[id]`, `/sponsor-faq` |
| S | 46 | Static triage; sampled domain widgets only |
| X | 16 | 8 auth, 7 public, `/` |

Axe-scanned routes by outcome: `/`, `/login`, `/signup`, `/forgot-password`,
`/terms`, `/privacy`, `/design-system`, `/timetable`, `/event`, `/inbox`,
`/users`, `/permissions`, `/schedule` all pass in both themes against fixtures.
Fixtures are populated only where noted in the spec (a user, a schedule
activity); other pages were scanned in their fixture state, not with
production data.

<details>
<summary>All 72 routes</summary>

| Route | Coverage | Axe light+dark |
|---|---|---|
| `/announcements` | S | — |
| `/applications/[id]` | S | — |
| `/applications/new` | S | — |
| `/applications` | S | — |
| `/audit/[id]` | S | — |
| `/audit` | S | — |
| `/challenge/[id]` | S | — |
| `/challenges/[id]` | S | — |
| `/challenges/new` | S | — |
| `/challenges` | S | — |
| `/company-tags` | S | — |
| `/enterprises/[id]` | S | — |
| `/enterprises` | S | — |
| `/event` | S | yes |
| `/gallery/[id]` | S | — |
| `/gallery` | S | — |
| `/inbox` | S | yes |
| `/judging` | D | — |
| `/logistics/accreditation` | S | — |
| `/logistics/activities` | S | — |
| `/logistics/meals` | S | — |
| `/logistics` | S | — |
| `/logistics/presence` | S | — |
| `/logistics/stats` | R + D | — |
| `/my-applications/[id]` | S | — |
| `/my-applications` | S | — |
| `/my-project/[id]` | S | — |
| `/my-project` | S | — |
| `/my-queue` | S | — |
| `/people/[userId]` | S | — |
| `/people` | D | — |
| `/permissions/[roleId]` | D | — |
| `/permissions` | D | yes |
| `/projects/[id]` | S | — |
| `/projects/form` | S | — |
| `/projects` | S | — |
| `/queue` | S | — |
| `/queue/queues/[id]` | D | — |
| `/queue/reviews/[entryId]` | S | — |
| `/queue/reviews` | S | — |
| `/queue/rooms` | S | — |
| `/queue/settings` | S | — |
| `/reports` | S | — |
| `/schedule` | R + D | yes |
| `/settings/event` | R + D | — |
| `/settings/libraries` | S | — |
| `/settings/profile` | S | — |
| `/sponsor-faq` | D | — |
| `/timetable` | S | yes |
| `/tv/control` | S | — |
| `/users/[id]` | S | — |
| `/users/invites` | R + D | — |
| `/users` | S | yes |
| `/wallet` | S | — |
| `/applications/confirm` | X | — |
| `/applications/decline` | X | — |
| `/claim-account` | X | — |
| `/forgot-password` | X | yes |
| `/login` | X | yes |
| `/reset-password` | X | — |
| `/signup` | X | yes |
| `/verify-email` | X | — |
| `/judging-popup/[entryId]` | S | — |
| `/review-popup/[responseId]` | S | — |
| `/design-system` | X | yes |
| `/privacy` | X | yes |
| `/s/[code]` | X | — |
| `/terms` | X | yes |
| `/tv` | X | — |
| `/verify/[code]` | X | — |
| `/verify` | X | — |
| `/` | X | yes |

</details>

Domain interactions reviewed from source (not exercised end to end): review
panel move handle and file docking keyboard sensors; question and section
reordering with explicit up/down actions; schedule double-click creation with a
native-button equivalent and arrow-key column resize; public timeline events as
native buttons; titled iframes for project video, application PDF and profile
CV with open/download paths; judging notes with named fields and polite save
status.

## 5. Regression suite

Run from the repo root (browsers: `pnpm test:ui:install`; the config starts the
fixtures it needs — see [ui-testing.md](./ui-testing.md)):

```sh
pnpm test:ui:browser accessibility-audit.spec.ts --project=chromium
pnpm test:ui:browser navigation-accessibility.spec.ts --project=chromium
pnpm test:ui:browser controls-accessibility.spec.ts --project=firefox
pnpm test:ui:browser page-accessibility.spec.ts --project=webkit
```

Swap `--project` between `chromium`, `firefox` and `webkit`; omit it to run all
three.

| Spec | Asserts |
|---|---|
| `e2e/browser/accessibility-audit.spec.ts` | Light and dark axe scans of the 14 scenarios listed in [§4](#4-route-coverage): zero violations, one `main`, `h1` present, locale and theme applied, results attached. Reflow of `/`, `/login`, `/inbox?tab=preferences`, `/timetable` at 320 px and 200 % text: no horizontal scroll and no visible control outside the viewport |
| `e2e/browser/navigation-accessibility.spec.ts` | Public section jump links and unobscured focus targets; expanded sidebar and icon rail reach every Access and audit child with Tab; one `main`, skip link first, route focus, collapsible active workspace; 320 px sheet lists all destinations and closes after keyboard navigation; forward routes reset focus and scroll while Back restores position; component preview shares public chrome; landing links clear the wrapped header at 200 % text |
| `e2e/browser/controls-accessibility.spec.ts` | One `h1` on each auth route; invalid sign-in focuses the password and exposes the error; controlled side panel traps focus and returns to its opener; language menu name and keyboard selection; recovery confirmation receives focus; nested dialog/select focus destinations; overlays under reduced motion; native input outline under forced colors; toast actions persist and Close/action are independent native controls |
| `e2e/browser/page-accessibility.spec.ts` | Invitation dialog: method pressed state, radio arrow keys, named limit and expiry fields |

Pre-existing specs extended during the audit also cover the fixed widgets:
`project-builder.spec.ts` (validation names), `schedule-layout.spec.ts` (inline
editing and keyboard resize), `statistics-chart.spec.ts` (exact values and
keyboard filtering). Component-level tests sit beside the code
(`ui/accessibility.test.tsx`, `ui/toast-accessibility.test.tsx`,
`common/picker-accessibility.test.tsx`, `common/question-field.test.tsx`).

## 6. Limitations

No claim of WCAG conformance is made. What remains unverified:

- **Screen readers**: no VoiceOver, NVDA or JAWS pass. Automated name, role and
  state checks are not a substitute for hearing the page; live-region and
  announcement behaviour was inspected in source only.
- **Speech input**: not exercised. Label-in-name fixes target it, but no
  dictation tool was run.
- **Forced colors**: emulated through the browser, not run on Windows High
  Contrast.
- **Zoom and reflow**: 200 % text at 320 px on four routes. 400 % browser zoom
  and the other routes are not exhaustive.
- **Long words at large text**: at 320 px and 200 % text, display headings
  break inside words (for example "applica-tions") rather than clipping. Content
  stays readable and operable; typographic hyphenation was not tuned.
- **Locales**: Spanish and Galician at narrow widths and enlarged text were not
  verified; the reflow checks ran in English.
- **External content**: embedded video captions and transcripts, and PDF tagging
  and reading order, cannot be inferred from iframe titles.
- **Camera scanner**: camera acquisition, manual fallback and physical scanning
  were not exercised.
- **Real backend**: all rendered checks use deterministic fixtures, not the real
  API, authentication or production data.
- **Route depth**: 46 of 72 routes are source triage only; conditional states
  (errors, empty, loading, populated calendar overlap, popups, drag/dock
  cancel and rollback) are largely unexercised.
- **Safari**: Playwright WebKit stands in for Safari; see [§3](#3-safari-tab-skips-links).

## 7. Maintenance

- Run the four specs in [§5](#5-regression-suite) before merging UI changes to
  shell, overlays, form controls, toasts, tokens or auth.
- A new screen adds one scenario to the axe matrix in
  `accessibility-audit.spec.ts` (light and dark) and, if it introduces a new
  interaction pattern, a keyboard flow in the matching spec. Update the
  [§4](#4-route-coverage) counts and table in the same change.
- Moving a fix updates the `path:line` in [§2](#2-findings); a row whose code
  was removed is deleted, not left stale.
- Do not raise a route's coverage from S to R/D without a rendered run or an
  actual source review of that route.
- New findings take the same row format: severity, location, before, after,
  user impact.
