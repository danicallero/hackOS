# hackOS design system, UI & UX

The consolidated design rulebook for every hackOS surface: the Next.js web
app, the Expo mobile app, public pages, and TV displays. Written for both
humans and agents: every section opens with a one-line summary, tokens carry
their intent and boundaries (not just values), and components come with the
decision logic for when to use them.

Product behaviour stays owned by `plan/historias-hackos.md` (H1–H59). This doc
owns *how things look, read, and feel*.

## Product brief

hackOS runs a hackathon end to end: applications, admissions, accreditation,
live judging queues, sponsors, and communications — one platform replacing
four legacy tools. Its UI serves two very different situations with one design
system: **participants and the public**, who need calm, task-led screens they
see a few times; and **staff running a live event**, who need compact,
state-led screens that stay legible and safe under time pressure, flaky venue
Wi-Fi, and long shifts. A single account can hold both jobs at once —
capabilities add tools, they never switch identities.

## Index

| Section | Answers |
| --- | --- |
| [1. Principles](#1-principles) | The five rules every other rule derives from |
| [2. Foundation tokens](#2-foundation-tokens) | Spacing, type, controls, radius, elevation — value, intent, boundary |
| [3. Containers](#3-containers) | `Surface` vs `Section` vs `Overlay` — which wrapper, when |
| [4. Page & action hierarchy](#4-page-and-action-hierarchy) | `PageHeader` anatomy; primary/secondary/overflow action logic |
| [5. Component decision logic](#5-component-decision-logic) | Which shared component fits which job |
| [6. Tables, forms, and states](#6-tables-forms-and-states) | Rules for data display, form UX, loading/empty/error |
| [7. Information architecture](#7-information-architecture) | Personal area + additive capability workspaces |
| [8. Domain state models](#8-domain-state-models-that-must-stay-visually-distinct) | Business distinctions the UI must never blur |
| [9. Accessibility](#9-accessibility) | The non-negotiable keyboard/label/announce/colour rules |
| [10. Copy & localization](#10-copy-and-localization) | Trilingual dictionary rules + writing style, machine-enforced |
| [11. Web specifics](#11-web-specifics) | Next.js/shadcn layer: what's vendored, gated, persisted |
| [11b. TV / kiosk surfaces](#11b-tv--kiosk-surfaces) | Venue screens: one screenful, `em` sizing, nothing that needs hover or scroll |
| [12. Mobile specifics](#12-mobile-specifics) | Expo/native constraints: tabs, scanners, wallet, touch |
| [13. Definition of done](#13-definition-of-done-for-ui-work) | The checklist every UI change must pass |
| [14. Implementation hotspots](#14-implementation-hotspots) | File map for every concern above |
| [15. Don'ts](#15-donts) | The short list of things this system never does |
| [16. History](#16-history) | Where this doc came from |

## 1. Principles

**Summary: one design system, two densities; capabilities add, never switch;
layout explains, text is the exception.**

- **Participant and public experiences are calm, approachable, task-led.**
- **Staff and live-event experiences are compact, state-led, resilient under
  time pressure.**
- **Access is additive and capability-based.** Roles are illustrative only and
  must never become exclusive workspaces or a role switcher (H8, H55).
- **Layout, state, and affordance explain the workflow.** Supporting text is
  reserved for risk, privacy, irreversible consequences, or genuinely
  unfamiliar domain rules.
- **Web and mobile share terminology and state models**, even when their
  interaction patterns are platform-native.

## 2. Foundation tokens

**Summary: everything on a 4px grid, semantic tokens only, one accent per
view; canonical values in `apps/web/src/app/globals.css`.**

Style only with semantic tokens (`bg-background`, `text-muted-foreground`,
`border`, `text-destructive`, …). Colour meaning comes from semantic tones
(`success`/`warning`/`danger`/`info`/`brand`/`neutral`,
`apps/web/src/lib/tones.ts`) — badges, meters, and charts all take a `tone`,
so a colour means the same thing everywhere.

Each row: value → intent → boundary.

| Token group | Value | Intent & boundary |
| --- | --- | --- |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48 px | 8px between tightly related controls, 16px within a section, 24px between sections. Never off-grid values. |
| Accent | one interactive accent | CTAs and active states only. Never decorative, never a background wash. One per view. |
| Status colours | via `tones.ts` | Reserved for actual state (queue, decision, sync). Never used to make neutral UI "more colorful". |
| Page title | 24/32 semibold (`type-page-title`) | One per page, in `PageHeader`. Never inside cards. |
| Section title | 18/24 semibold (`type-section-title`) | Titles a `Section`/`SectionCard`. Not a substitute for the page title. |
| Body | 14/20 regular | Default text. |
| Label | 13/18 medium (`type-label`) | Form labels and control captions. |
| Meta | 12/16 muted (`type-meta`) | Timestamps, counts, secondary facts. **No artificial tracking** — never add `tracking-*` to shared headings or metadata. |
| Data | `tabular-nums` | Any column of numbers. Monospace only for identifiers and timers — never for prose. |
| Controls | 24 px tiny/icon-xs, 32 px compact, 36 px default, 40 px prominent; 6 px radius | Tiny is for icon-only remove/inline affordances; compact is for dense staff tables; prominent is for mobile-friendly/primary flows. Use component `size` variants, never one-off height utilities. Multiline `Textarea` uses a separate 64 px minimum token. |
| Surfaces | 8 px radius, semantic border + background | **No shadow for inline grouping** — border-only. |
| Overlays | 8 px radius; small shadow (menus/popovers), large shadow (modals) | Elevation communicates "floating above the page" and nothing else. |
| Full radius | pills, avatars | Nowhere else. |

Uppercase/letter-spacing is not a hierarchy tool — use scale, weight, and
colour; reserve uppercase for real codes (badge IDs, room codes).

## 3. Containers

**Summary: three explicit levels — border-only `Surface`, titled `Section`,
elevated `Overlay` — replacing the overloaded generic "card".**

| Container | Use when | Never for |
| --- | --- | --- |
| `Surface` | Untitled inline grouping inside a page; compact padding | Anything needing a title or elevation |
| `Section` / `SectionCard` | A titled domain section with optional state/action; 16–20 px padding. `SectionCard` composes title/state/action/body — **the** form/detail container | Floating/interaction-owned content |
| `Overlay` | Dialog, popover, menu — interaction-owned, Radix-rendered, focus-managed; consumes `overlayVariants` | Inline content (never overlay shadows on the page) |

`Card` remains only as a compatibility wrapper over `Surface`; new domain
sections use `Section`/`SectionCard` so their responsibility is explicit. In
`app/(app)` the raw `Card`s that are deliberately *not* page sections are the
centered confirmation/auth cards (`verify-secondary-email/page.tsx`) and the
my-queue ticket stub. `schedule/page.tsx`'s search/filter bar is a known
exception still pending migration to `SectionCard`.
Every dashboard-style panel is a `SectionCard` (#300); a panel that re-builds
title/description/action out of `CardHeader` also re-invents the spacing and
re-introduces the description-restates-the-title pattern.
Public marketing cards may use more whitespace but keep the same radius and
colour tokens.

```tsx
<SectionCard
  title={t("roomQueues")}
  state={<StatusBadge>{rooms.length}</StatusBadge>}
  action={<Button variant="outline">{t("viewAll")}</Button>}
>
  {children}
</SectionCard>
```

## 4. Page and action hierarchy

**Summary: title-first `PageHeader`, one primary action per scope,
descriptions only for risk/policy, disabled actions explain themselves.**

`PageHeader` anatomy: optional `leading` (avatar/logo on record pages) →
optional `context` (breadcrumb or workspace label) → title → `state` (nearby
count/status when useful) → optional `meta` (identity metadata: email, badge
id) → one `primaryAction` + optional `secondaryActions`.

- **Record pages use the same header as every other page.** An avatar goes in
  `leading` and the identity line in `meta` — don't hand-roll a second header
  layout with its own `h1` size and an `ml-auto` action block, which strands
  the actions on their own right-aligned row as soon as the title row wraps.
- **The top bar carries the workspace, the page carries its own name.** The
  sticky app-shell bar names the containing workspace; the `h1` names the
  destination. Never render the same string in both, and never give one
  destination two names — `nav.ts` and the page `h1` reference the same
  message key (issue #297).
- **`context` is the parent crumb, not a second back button.** On detail
  routes it links to the list the record came from; don't repeat that link as
  a header action.
- **Descriptions are exceptional.** Add one only for a policy, risk,
  consequence, or unfamiliar state — never to restate the title or enumerate
  the content visible below.
- **One primary action per scope.** Supporting work uses outline/ghost
  buttons; rare or exceptional actions live in a dropdown/overflow menu.
- Destructive styling appears only on the destructive action and its
  confirmation.
- Disabled transactional actions keep their blocking reason next to the
  control (helper or status text), connected with `aria-describedby` when it
  isn't in the accessible name.
- Icon-only actions require a localized accessible name and visible focus.

```tsx
<PageHeader
  title={t("queueOperations")}
  primaryAction={<Button>{t("generateQueues")}</Button>}
  secondaryActions={<Button variant="outline">{t("openJudging")}</Button>}
/>
```

## 5. Component decision logic

**Summary: the shared library is canonical — pick by job, extend by props,
never fork. Decide *whether* something is a dialog before deciding *which*
dialog. Full inventory: `apps/web/README.md` + the `/components` gallery in
the running app.**

### Is it a dialog at all?

A dialog is an **interruption**: it steals focus, hides the page behind it,
cannot be linked to, cannot be reopened where the reader left it, and has no
room to grow. Reach for one only when the interaction is short, self-contained
and genuinely modal — a confirmation, a single decision, one short form.

Everything else has a better home. Work down this list and stop at the first
match:

| The content is | Use | Not |
| --- | --- | --- |
| A record's own detail — several sections, its own data, something a reader will link to, come back to, or read alongside a list | A **route** (`/thing/[id]`, or a detail pane beside the list) | A `Modal`, however big |
| Secondary detail that belongs *with* a section and is only sometimes wanted | Inline disclosure (`Collapsible` / `Accordion`) inside the `SectionCard` | A dialog opened from a row |
| A whole alternative view of the same page's subject | A `TabBar` sub-view (§4) | A dialog per view |
| One short decision, confirmation, or small form | `Modal` / `AlertModal` | A route for a two-field form |

Two smells that mean a dialog has outgrown itself: it scrolls internally on a
laptop, or it contains its own tabs, its own list *and* its own form. Both mean
it should have been a route.

**Never put a table, a live-updating list, or a record's primary content in a
dialog.** A queue, a roster, a set of results are things people scan, sort and
return to; behind a modal they can't be linked, shared, or kept open next to
anything else.

### Which component

| Job | Use | Not |
| --- | --- | --- |
| Confirm an irreversible/destructive action | `AlertModal` | `Modal` with a red button, `window.confirm` |
| A short, self-contained dialog that passed the test above | `Modal` (controlled or `trigger`) | Hand-rolled Radix Dialog; anything the table above sends to a route |
| Report a failed load/submit in place | `ContextualError` (+ retry) | A toast alone |
| Confirm a completed action | Toast (sonner) | A modal interrupting the flow |
| Communicate entity status | `StatusBadge` with a `tone` (queue states: `QueueStatusBadge`) | Coloured text, custom pills |
| A metric | `StatCard` (delta/footer slots for meters/sparklines) | Bare big numbers in a `Surface` |
| Comparative data, sorting, bulk selection | `DataTable<T>` | Custom table markup |
| A horizontal tab bar | `TabBar` (scrolls itself when the triggers outgrow the container) | Bare `TabsList` with a per-page `overflow-x-auto` wrapper or `flex-wrap`, which the fixed pill height clips |
| A group of adjacent actions | `ActionGroup` (wraps with the shared 8 px gap) | Repeated per-page flex/gap wrappers with divergent wrapping |
| An icon-only action | `IconButton` (localized `label`, token-backed hit area) | A bare `<button>` or `Button` with a hand-written `size-*` override |
| A combobox/multi-select inside a `Modal` | `MultiSelect`/`UniversityPicker`/`UserPicker`/`EntityCombobox` with `inDialog` | The same control without it — its list then either can't scroll or spills outside the dialog |
| Pick one row from a table-backed list (users, enterprises, activities, …) | `UserPicker` (server-searched) or `EntityCombobox` (client-filtered, already-fetched list) | A `Select` dumping every row flat — unusable once the table grows past a handful of rows |
| A set of same-shaped objects users drill into (esp. mobile) | Cards / drill-down list rows | A horizontally scrolling table |
| Zero-state | `EmptyState` with one direct CTA | Prose explaining where to navigate |
| Long-form save feedback | `SaveStatus` (`lib/save-state.ts`) | Silent autosave, per-section save buttons |
| Application-template fields (any kind) | `TemplateFieldControl` — the single renderer both applicant form and staff review use | A second field renderer |
| Gate UI by permission | `<CapabilityGate>` / `useCan(cap)` | Checking `me.role` |

The primitives layer (`components/ui/*`, shadcn) keeps vendored behavior and
structure. Its token-backed visual defaults are maintained as part of the web
design contract, so control geometry and interaction states may be aligned
there; domain behavior never belongs in the primitives. Project-specific
compositions wrap them in `components/common/`. If a widget is needed twice,
it moves to `components/common/` — one canonical component configured by props,
never a forked second version.

## 6. Tables, forms, and states

**Summary: keyboard-real rows, labelled search, visible save state,
skeleton loading, contextual errors, one-CTA empty states.**

Tables and lists:

- Navigation rows are links or fully keyboard-operable controls with focus
  styling and an accessible name — never mouse-only `onClick` rows.
- Search gets a real label (persistent or visually hidden), a clear action,
  and a result count — placeholders are not labels.
- An empty dataset and zero filter results are different states; the filtered
  one offers "Clear filters".
- No two columns in one table share a header: a repeated header makes sorting
  do two different things depending on which one is clicked (#299).
- Bulk actions appear only after selection and state what set they affect.
- An inline-editable grid navigates like a spreadsheet: arrows move between
  cells, Tab/Enter commit and move, Escape reverts — and both the row-selection
  checkbox and the row actions are cells too, so nothing in a row needs a
  mouse. While a cell is *open for editing* the horizontal arrows belong to the
  caret, not to the grid, and ending an edit hands focus back to that cell
  rather than dropping it on `<body>`. A cell that can't be edited in the
  current state (a publish date on an already-shown item) renders as read-only
  text and drops out of the navigation order instead of offering a dead editor.
- Batch operations that can partially fail report a durable result panel
  (skipped rows + reasons), not only a toast.
- In a table whose order carries meaning (a run-of-show ordered by time), a row
  is added *where it belongs*: a hairline between two rows reveals a "+" that
  inserts a draft row in that slot, and the slot supplies what the position
  already implies (its start and end), so the draft asks only for the name.
  Everything else is filled in the row itself once it exists; the full form
  stays available for the details that have no column. Every such gesture keeps
  a keyboard-reachable equivalent — a mouse-only affordance (double-click,
  drag) is an accelerator, never the only way in.
- A page whose primary action creates rows in a long table keeps that action
  reachable from anywhere in the scroll (a sticky button over the table's
  bottom corner), instead of only in the page header where a scrolled-down
  user can't see it.

Forms:

- Labels stay visible; placeholders hold examples, never instructions.
- Errors appear next to the field and are announced.
- Uncommon or technical settings go behind progressive disclosure ("More
  options"); internal keys are generated from the primary label, never asked
  for.
- Long forms keep persistent save state (saved / unsaved / saving / conflict /
  offline) and sticky actions.
- Put a live preview beside configuration whenever the user is shaping a
  visible artifact (Wallet pass, TV mode, application form).
- An optional date/time whose absence has behavioral meaning ("opens
  immediately", "never closes", "no end date") gets an explicit checkbox
  (`DateTimeInput`'s `nullOption`) that states the meaning in its label —
  never a hint telling the user to "leave it blank" or "clear it" to get that
  behavior. The input keeps a min-width floor so the native date/time text
  never clips inside a narrow grid or flex slot.

Loading / empty / error:

- Loading uses structural skeletons matching the layout they replace.
- A failed region keeps its error and retry in that region; toasts are never
  the only channel for a critical failure.
- An empty state adds an action only when the page has no other way out — if a
  persistent back/escape control is already on screen, don't repeat it (#299).
- **Capability-denied pages render `<AccessDenied ask={t("…")} />` and nothing
  else** (`components/common/access-denied.tsx`, issue #298). The heading is
  the same everywhere because the fact is the same everywhere; the only
  per-page string is the ask, which names the access to request ("Ask an
  administrator for project access."). Never hand-roll a lock `EmptyState`, and
  never name a capability key in it. It is a rendering component, not a gate —
  the page keeps its own capability check and the API still enforces it.
- Non-capability empty states (no results, nothing yet, failed load) stay
  bespoke `EmptyState`s; `AccessDenied` is only for "you may not see this".

## 7. Information architecture

**Summary: a stable personal area for everyone + additive capability-gated
workspaces; nothing hides to make room. Implementation and full
capability→workspace mapping: [`navigation.md`](./navigation.md).**

- Personal area (always, for any authenticated account): Home, Schedule, My
  applications, My project, My queue, Wallet, Inbox, Profile. Concepts that
  aren't available yet don't become permanent empty nav items.
- Work area: capability-gated workspaces — Applications, Projects, Live
  judging, Logistics, Programme, Sponsors, Event setup,
  Access and audit. A participant who also judges keeps their personal queue
  *and* gains Live judging.
- Keep the last workspace per device; order time-critical work above
  configuration during the event.
- Counts and state communicate attention — not "Soon" badges.

## 8. Domain state models that must stay visually distinct

**Summary: these distinctions are business-critical; blurring them is a
product bug, not a styling choice.**

- **Internal vs communicated admissions decisions** (H14–H15): "accepted
  internally" must never resemble a communicated acceptance. Review → Outbox →
  Sent decisions are separate spaces.
- **Queue physical states** (H29–H40): Called → In room → Presenting →
  Scored. "Bring in" and "Start presentation" stay separate primary actions.
  Judging shows persistent collaborative save state (saving/saved/offline/
  conflict, who's editing, draft vs submitted, attribution of changes).
- **Scanner truth** (H22–H26): Ready → **Saved on this device** → Confirmed /
  Needs attention. A locally queued scan must never look like
  server-confirmed completion; pending device operations stay visible across
  navigation and restart.
- **Ticket vs badge** (H22–H23, H28): visibly distinct objects everywhere.
- **Import preview vs write** (H16): the preview visibly states it performs no
  writes ("Nothing imports until you confirm").
- **Mandatory vs optional notifications** (H51): mandatory categories render
  as a locked "Always on" row, not a disabled switch.
- **Delete vs anonymize** (H54): eligibility is checked first; the
  confirmation names what is retained and what access is revoked.

## 9. Accessibility

**Summary: keyboard-complete, labelled, announced, and never colour-alone.**

- Keyboard: every interactive element reachable and operable; visible focus on
  buttons, rows, tabs, menus, dialogs; dialogs return focus to their trigger.
- Labels: all inputs labelled independently of placeholders; helper/error text
  associated via `aria-describedby`.
- Announcements: critical form errors and sync failures are announced; busy
  states are programmatically exposed and prevent accidental repeat submits.
- Never rely on colour alone for queue, decision, connection, or scan state.
- Charts expose exact values outside hover-only tooltips (table or text
  alternative for every chart).

## 10. Copy and localization

**Summary: every string lives in the i18n dictionary in es/gl/en; copy names
tasks and objects, never internals. Machine-enforced by `pnpm check:copy`.**

`scripts/check-copy.mjs` (part of `pnpm lint`) checks every i18next resource
under `packages/shared/locales/{en,es,gl}/{common,web,mobile,email}.json`:
every key carries **es / gl / en**, and copy never leaks story IDs (`H29`) or
capability-key syntax (`queue:admin`).

All translation resources under `packages/shared/locales/{en,es,gl}/` are
canonical runtime JSON and must be edited directly. The four namespaces are
`common.json`, `web.json`, `mobile.json`, and `email.json`; `check-copy.mjs`
validates their locale coverage and copy rules.

Writing rules:

1. Titles name the object or task.
2. Buttons use a verb + concrete object where ambiguity exists.
3. Descriptions explain only risk, consequence, policy, or an unfamiliar
   state.
4. Placeholders contain examples, not instructions.
5. Avoid "below", "navigate", "manage", "seamlessly", "get started", and
   enumerations of visible content.
6. Never expose story numbers, capability keys, API concepts, or internal
   state names to ordinary users. Capability-denied states say "Ask an
   administrator for … access", not the capability key.
7. Preserve deliberate brand personality when it is specific and human — the
   cookie notice's political/Ursula joke is explicitly retained (localized and
   tokenized, but not sanitized).

Calibration examples:

| Instead of | Write / do |
| --- | --- |
| "Sign in to hackOS." | Omit — title and fields suffice |
| "Create rooms in Administration to start building queue views." | Empty state "No rooms yet" + **Create room** |
| "The accreditation scan capability is required." | "Ask an administrator for accreditation access." |
| "H19: lets each participant create…" | "Participants can create their own projects." |
| Generic "Pending" on an offline scan | "Saved on this device" |
| "Nothing to show" | Contextual: "No users", "No applications", "No results" |
| "Turn off" on mandatory queue alerts | Locked "Always on" row |

## 11. Web specifics

**Summary: Next.js 16 + shadcn (vendored) + Tailwind v4 tokens; sidebar
workspaces with per-device persistence; conventions in
[`apps/web/README.md`](../apps/web/README.md).**

- File organisation: when a route outgrows a single `page.tsx`, follow the
  "Page structure" rule in `apps/web/README.md` — split by independently
  meaningful parts (tabs, modals, decision logic), never by line count alone.
- Dark-first, Dokploy-family visual identity; light and dark both fully
  supported via `next-themes` — every screen must read correctly in both.
- Navigation: `lib/nav.ts` (`PERSONAL_NAV` + `WORKSPACES`) rendered by
  `AppSidebar`. Workspaces are collapsible groups; the expanded workspace
  persists per device (`localStorage` `hackos-last-workspace`); the icon rail
  and mobile sheet bypass the accordion so every item stays directly
  reachable. Route hrefs are stable — deep links and bookmarks must keep
  working; don't move routes for IA reasons.
- Primitives (`components/ui/*`) come from the shadcn CLI
  (`pnpm dlx shadcn@latest add <name> -y`) and are biome-ignored. Keep their
  behavior/structure vendored; token-backed visual defaults may be maintained
  there as part of the shared control contract. Wrap project variants in
  `components/common/`.
- The `/components` route in the running app is the live gallery of every
  shared widget with variations — check it before building UI.
- Errors from the API surface `ApiError.message` verbatim (already
  human-readable and localized server-side).
- Domain models/pure logic live in `lib/<domain>.ts` with colocated
  `*.test.ts(x)` (vitest) — visual behaviour that encodes state machines
  (workflow tabs, judging access, nav gating) is unit-tested, not just eyeballed.

## 11b. TV / kiosk surfaces

**Summary: one screenful, no scroll, no hover; sized in `em` off a measured
scale so the same view fills a 1080p panel, a 4K wall and a portrait totem.**

Venue screens (`apps/web/src/app/(public)/tv/`) are read-only, unattended, and
viewed from across a room. Full behaviour in [`tv-screens.md`](./tv-screens.md);
the rules that bind UI work:

- **Never scroll the page.** `TvScreen` is `h-dvh` with `overflow-hidden`.
  Content that doesn't fit must shrink, window, or marquee — never rely on a
  scrollbar nobody can reach.
- **Size in `em`, not rem steps.** `TvScreen` sets the root font size from
  `useTvScale()`; a `text-3xl` inside it stays pinned to the browser root and
  ignores the screen entirely. Use `text-[1.75em]`, `p-[2em]`, `gap-[1em]`.
- **Nothing may require hover, focus, click, or scroll to be read.** Overflowing
  text uses `MarqueeText`, never a truncating ellipsis or a tooltip.
- **One shared top bar.** Every TV mode uses `TvHeader`; dense room grids use
  its compact variant instead of rebuilding brand, event name, and clock.
- **Announcements are content, not a TV mode.** An active announcement may
  temporarily replace the base view at full screen or occupy reserved space
  inside it. Embedded announcements never cover schedule, room, sponsor, or
  Wi-Fi content, and a null end keeps them present until deletion.
- **Assume portrait exists.** `TvScreen` reports `portrait`; stack rather than
  squeeze.
- **Set leading explicitly on anything that wraps.** `globals.css` puts a fixed
  `line-height: 1.25rem` on `body`; an `em`-sized TV paragraph inherits that
  20px line box and prints its lines on top of each other. `TvScreen` resets to
  a unitless leading — don't re-introduce a rem line-height underneath it.
- **QR codes are functional, not decorative.** Dark-on-light with a quiet zone
  (`WifiQr` carries its own white plate), generated locally — never through an
  external QR service, which both breaks on a venue with no uplink and hands the
  venue Wi-Fi password to a third party.
- Semantic tokens and both colour schemes apply as everywhere else — venues run
  screens in both.

## 12. Mobile specifics

**Summary: Expo Router with a custom platform-adaptive tab bar, the system
Wallet button, native confirmations — plus offline-first scanner UX. Full
architecture: [`mobile.md`](./mobile.md).**

- **Tab budget is hard.** Every platform uses the custom Expo Router shell in
  `components/router-tabs.tsx`: iOS 26+ renders Liquid Glass surfaces, while
  earlier iOS and Android use the same geometry with solid surfaces. Five total
  destinations are rendered directly on compact screens; tablet-width layouts
  can fit up to six before using a separate `Others` circle. The complete route
  registry remains mounted so hidden screens stay routable. The direct group is
  a single finger-scrub surface: its
  selection lens follows the touch continuously and release selects the cell
  under the final finger coordinate, including a jump across several direct
  tabs. `Others` stays a separate native menu trigger.
  - **Participants** (no scan capability): schedule, queue, wallet,
    notifications, and **Account** are all direct because the set has five
    destinations.
  - **Operators** (any scan capability or admin `*`): daily tools win the
    bar — schedule, **Scanner**, Activities (only with `activity:scan`),
    notifications — and the separate **"Others" overflow selector** holds
    the less-frequent personal tabs (Queue, Wallet, Account) and any queue
    operations destination as pseudo-tabs (`lib/tabs.ts`
    `primaryTabs`/`overflowTabs`).
- **The overflow selector is a separate circle that opens a dropdown, not a
  screen.** `Others` is a direct custom button, not a fake `role="search"`
  tab. It opens a native `MenuView` (`@expo/ui/community/menu`) listing the
  overflow pseudo-tabs with icon + localized label; the compact layout uses a
  64pt bar and circle, while tablet-width layouts use a slightly thinner 56pt
  pair. Both keep 16pt horizontal display padding so iOS SwiftUI and Android
  Compose share the same target.
- **Pseudo-tabs simulate tab navigation, with a dedicated contract**
  (`lib/operations-navigation.ts` `resolveOperationsNavigationAction`):
  selecting the section you're already in is a **no-op**; selecting another
  always uses `router.replace()`, never `push()` — a tab switch, not a
  stack push, so overflow screens never stack duplicates and back behaviour
  stays sane. Direct tabs use the headless Expo Router tab state (`JUMP_TO`)
  and emit `tabPress`, preserving each tab's stack and its scroll-to-top/live-
  activity handlers. Within a section, deeper screens push normally on top of it.
  Normalize Expo Router route groups before matching paths (`/others/...`
  vs `/(tabs)/others/...`). Do not re-implement overflow entries as plain
  stack links — earlier versions regressed exactly this way.
- **Offline scanner UX is the flagship constraint**: scans persist to SQLite
  before any network call, replay in order with the persisted scan id as
  `Idempotency-Key`, and render the §8 scanner states. Business rejections
  (4xx) surface to the operator; network failures stay "Saved on this
  device" and never look done.
- **Native controls where the platform mandates them**: Apple Wallet uses the
  system `PKAddPassButton` (never custom artwork, per Apple's guidelines);
  destructive actions (delete message, sign out) use native confirmation
  alerts; lists use native section/grouped styling.
- Touch and layout: primary targets ≥ 44 pt; safe-area insets respected for
  fixed actions and scanner feedback; critical scan actions never depend on
  small overflow menus.
- **Android chrome is not iOS chrome, and the code has to say so.**
  `headerTransparent` / `headerLargeTitle` and `contentInsetAdjustmentBehavior`
  are iOS-only: on Android they leave a floating header over unshifted content.
  Gate those options on `process.env.EXPO_OS === "ios"` and let Android keep its
  opaque compact app bar, or pad the scroll content by the full header height
  yourself. Header-less Android tab screens draw edge-to-edge under a
  transparent status bar, so they need `AndroidStatusBarScrim` (`native-ui`) to
  keep scrolled rows from sliding behind the clock.
- **`presentationStyle="pageSheet"` is an iOS presentation.** On Android the
  same `Modal` is a plain full-screen window with no inset card, so every sheet
  adds the status-bar inset to its own header padding and floating chrome
  (`sheetTopInset`) instead of assuming the sheet starts below the status bar.
- **Semantic colors resolve per platform, per scheme.** `theme/colors.ts` is the
  only place that knows which system palette a token comes from: UIKit's dynamic
  colors on iOS, the *same palette as an explicit light/dark pair* on Android.
  Material You was tried and rejected — its neutrals are lavender-tinted with
  almost no contrast between page and card, and its `*Container` roles look
  nothing like this app's tinted banners. Android tokens are read lazily against
  the current scheme, never resolved once at module load (that froze the palette
  to the scheme the app launched in), so avoid capturing a token in a
  module-scope `StyleSheet.create`. Text or icons on a tinted `…Surface` use the
  matching `on…Surface` token; the base tone is for a tinted mark on the
  ordinary page background.
- Mobile authentication keeps submit actions discoverable, reports missing
  values inline and focuses the first invalid field. Sign-in uses the native
  `username`/`current-password` credential pairing plus the configured iOS
  `webcredentials` domain; password reveal controls have changing localized
  accessible names and at least a 44-point target. Its form is fixed and its
  short account note stays at the safe-area bottom at standard text sizes;
  accessibility text sizes may scroll rather than clip content. Filled primary
  actions and text links use the dedicated high-contrast mobile semantic pairs
  rather than assuming the system tint is legible as body text.
- Password recovery follows the same task-first composition and inline error
  pattern. Session restoration uses a neutral surface for the first 500 ms and
  only presents a progress announcement when the operation is genuinely slow,
  preventing transient content and VoiceOver noise during normal launches.
- A successfully authenticated account without mobile-event access is signed
  out and receives one native modal alert with a clear dismissal action. This
  access boundary must not be represented only as transient inline copy.
- Notifications render in the foreground too (Expo's default suppresses
  them); a tapped queue notification navigates to the queue tab.
- Copy comes from `lib/i18n.tsx` (react-i18next), reading
  `packages/shared/locales/{en,es,gl}/mobile.json` plus the shared
  `common.json` subset — intentionally smaller than web's resource file,
  same `check-copy` enforcement.
- Capability changes apply without reinstall: tabs recompute from a shared
  `/api/me` fetch that refetches on app foreground (H55).

## 13. Definition of done for UI work

Every UI change, web or mobile:

- References its Hxx stories; supports capability *combinations*, not fixed
  roles.
- Covers loading, empty, error, success, disabled, and permission-denied
  states.
- Provides keyboard, focus, accessible-name, and announcement behaviour.
- Updates Spanish, Galician, and English together.
- Uses shared tokens and primitives — extends the shared layer rather than
  forking.
- Includes responsive verification, and real-device verification where
  native/offline behaviour applies.
- Adds or updates tests for state transitions and interaction semantics.
- Keeps cross-surface UI hooks in `@hackos/shared/ui-test-ids` when a flow needs
  a stable contract across locales; tests prefer accessible roles and names,
  never styling classes or layout text.

## 14. Implementation hotspots

| Concern | Where |
| --- | --- |
| Colour/radius/type tokens | `apps/web/src/app/globals.css` |
| Tones | `apps/web/src/lib/tones.ts` |
| Page hierarchy | `apps/web/src/components/common/page-header.tsx` |
| Sections/surfaces | `apps/web/src/components/common/section-card.tsx` |
| Tables, search, rows | `apps/web/src/components/common/data-table.tsx` |
| Shared actions and control geometry | `apps/web/src/components/common/action-group.tsx`, `icon-button.tsx`, `apps/web/src/components/ui/{button,input,select,tabs}.tsx` |
| Web navigation | `apps/web/src/lib/nav.ts` |
| Mobile tabs | `apps/mobile/lib/tabs.ts` |
| Mobile pseudo-tab navigation | `apps/mobile/lib/operations-navigation.ts` |
| Scanner sync state model | `apps/mobile/lib/scanner-sync.ts` |
| Product copy | `packages/shared/locales/{en,es,gl}/{common,web,mobile,email}.json` |
| Copy enforcement | `scripts/check-copy.mjs` |

Inventory commands for staged migrations (redundant descriptions, tracking
utilities):

```sh
rg -n '<PageHeader' apps/web/src/app apps/web/src/components
rg -n '<SectionCard' apps/web/src/app apps/web/src/components
rg -n 'tracking-(tight|wide|wider|widest)' apps/web/src/components
```

## 15. Don'ts

The system never does these. Treat a diff that introduces one as a bug:

1. No role-based UI. `me.role` is display-only; gating is always by
   capability or association fact (`isEnterpriseJudge`, `isSponsorRep`).
2. No hardcoded colours (hex/oklch) or off-token spacing in components.
3. No hardcoded user-facing strings — everything through the i18n dictionary,
   all three locales at once.
4. No story IDs, capability keys, or API/database concepts in user-facing
   copy.
5. No shadows on inline surfaces; elevation belongs to overlays only.
6. No second version of a shared component — extend by props or wrap.
7. No one-off control geometry — use the shared `size` variants and tokens;
   `SelectTrigger size="content"` is the only wrapping opt-in.
8. No mouse-only interactions: no clickable rows without keyboard semantics,
   no hover-only data.
9. No colour-alone state communication, and no toast-only critical failures.
10. No descriptions that restate the title or enumerate visible content;
   no "Soon" badges as attention devices.
11. No UI that makes a locally queued scan look server-confirmed, or an
    internal decision look communicated.

## 16. History

This document absorbs the former `design-system-migration.md`, the UX/UI
audit, and its agent launch guide, delivered through the UX audit epic
([#197](https://github.com/danicallero/hackOS/issues/197), issues #185–#196):
shared tokens/surfaces/hierarchy (#185), accessible data and error states
(#186), capability-based workspaces (#187), identity/application continuity
(#188–#189), queue/judging states (#190), scanner sync truth (#191), the
sponsor/programme/statistics/settings workspaces (#192–#195), and the
copy/localization sweep (#196). The audit narrative and per-issue sequencing
live in those GitHub issues; the durable rules all live here.
