# hackOS design system, UI & UX

The consolidated design rulebook for every hackOS surface: the Next.js web
app, the Expo mobile app, public pages, and TV displays. Written for both
humans and agents: every section opens with a one-line summary, tokens carry
their intent and boundaries (not just values), and components come with the
decision logic for when to use them.

Product behaviour stays owned by `plan/historias-hackos.md` (H1–H55). This doc
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
| Controls | 36 px default, 32 px compact, 40 px prominent; 6 px radius | Compact only in dense staff tables; prominent for mobile-friendly/primary flows. |
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
sections use `Section`/`SectionCard` so their responsibility is explicit.
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

`PageHeader` anatomy: optional `context` (breadcrumb or workspace label) →
title → `state` (nearby count/status when useful) → one `primaryAction` +
optional `secondaryActions`.

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
never fork. Full inventory: `apps/web/README.md` + the `/components` gallery
in the running app.**

| Job | Use | Not |
| --- | --- | --- |
| Confirm an irreversible/destructive action | `AlertModal` | `Modal` with a red button, `window.confirm` |
| Any other dialog | `Modal` (controlled or `trigger`) | Hand-rolled Radix Dialog |
| Report a failed load/submit in place | `ContextualError` (+ retry) | A toast alone |
| Confirm a completed action | Toast (sonner) | A modal interrupting the flow |
| Communicate entity status | `StatusBadge` with a `tone` (queue states: `QueueStatusBadge`) | Coloured text, custom pills |
| A metric | `StatCard` (delta/footer slots for meters/sparklines) | Bare big numbers in a `Surface` |
| Comparative data, sorting, bulk selection | `DataTable<T>` | Custom table markup |
| A set of same-shaped objects users drill into (esp. mobile) | Cards / drill-down list rows | A horizontally scrolling table |
| Zero-state | `EmptyState` with one direct CTA | Prose explaining where to navigate |
| Long-form save feedback | `SaveStatus` (`lib/save-state.ts`) | Silent autosave, per-section save buttons |
| Application-template fields (any kind) | `TemplateFieldControl` — the single renderer both applicant form and staff review use | A second field renderer |
| Gate UI by permission | `<CapabilityGate>` / `useCan(cap)` | Checking `me.role` |

The primitives layer (`components/ui/*`, shadcn) is **vendored/generated —
never hand-edited**; project variants wrap primitives in `components/common/`.
If a widget is needed twice, it moves to `components/common/` — one canonical
component configured by props, never a forked second version.

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
- Batch operations that can partially fail report a durable result panel
  (skipped rows + reasons), not only a toast.

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
  judging, Logistics, Programme, Sponsors, Communications, Event setup,
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

`scripts/check-copy.mjs` (part of `pnpm lint`) checks
`apps/web/src/lib/i18n.ts` and `apps/mobile/lib/i18n.tsx`: every entry carries
**es / gl / en**, and copy never leaks story IDs (`H29`) or capability-key
syntax (`queue:admin`).

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
  (`pnpm dlx shadcn@latest add <name> -y`), are biome-ignored, and are never
  hand-edited; wrap them in `components/common/` for project variants.
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

**Summary: Expo Router with native platform behaviour — the iOS tab bar, the
system Wallet button, native confirmations — plus offline-first scanner UX.
Full architecture: [`mobile.md`](./mobile.md).**

- **Tab budget is hard.** The bar is a real platform tab bar
  (`expo-router/unstable-native-tabs`), and iOS's `UITabBarController`
  silently collapses anything past its fifth item into its own "More"
  screen, bypassing app UI — a 6-tab bar is not an available option. Every
  route declares a trigger; which ones show is toggled per experience with
  `hidden`, so hidden screens stay routable.
  - **Participants** (no scan capability): schedule, queue, wallet,
    notifications + **Account** directly in slot 5. No overflow at all.
  - **Operators** (any scan capability or admin `*`): daily tools win the
    bar — schedule, **Scanner**, Activities (only with `activity:scan`),
    notifications — and slot 5 becomes the **"Others" overflow selector**;
    the less-frequent personal tabs (Queue, Wallet, Account) move behind it
    as pseudo-tabs (`lib/tabs.ts` `primaryTabs`/`overflowTabs`).
- **The overflow selector is a tab that opens a dropdown, not a screen.**
  The "Others" trigger is declared with `role="search"`, which on iOS 18+
  renders it as the separated (Liquid Glass) capsule, visually split from
  the tab group — ellipsis icon, hidden label. It never navigates: an
  invisible native `MenuView` (`@expo/ui/community/menu`) is absolutely
  positioned over the capsule and opens a native dropdown listing the
  overflow pseudo-tabs with icon + localized label. (Android additionally
  needs a plain `Pressable` overlay calling the menu's imperative `show()`,
  because the Compose interop tree intermittently drops the first touch.)
- **Pseudo-tabs simulate tab navigation, with a dedicated contract**
  (`lib/operations-navigation.ts` `resolveOperationsNavigationAction`):
  selecting the section you're already in is a **no-op**; selecting another
  always uses `router.replace()`, never `push()` — a tab switch, not a
  stack push, so overflow screens never stack duplicates and back behaviour
  stays sane. Within a section, deeper screens push normally on top of it.
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
- Notifications render in the foreground too (Expo's default suppresses
  them); a tapped queue notification navigates to the queue tab.
- Copy comes from `lib/i18n.tsx` — same `{ es, gl, en }` shape as web,
  intentionally smaller dictionary, same `check-copy` enforcement.
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

## 14. Implementation hotspots

| Concern | Where |
| --- | --- |
| Colour/radius/type tokens | `apps/web/src/app/globals.css` |
| Tones | `apps/web/src/lib/tones.ts` |
| Page hierarchy | `apps/web/src/components/common/page-header.tsx` |
| Sections/surfaces | `apps/web/src/components/common/section-card.tsx` |
| Tables, search, rows | `apps/web/src/components/common/data-table.tsx` |
| Web navigation | `apps/web/src/lib/nav.ts` |
| Mobile tabs | `apps/mobile/lib/tabs.ts` |
| Mobile pseudo-tab navigation | `apps/mobile/lib/operations-navigation.ts` |
| Scanner sync state model | `apps/mobile/lib/scanner-sync.ts` |
| Product copy | `apps/web/src/lib/i18n.ts`, `apps/mobile/lib/i18n.tsx` |
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
   capability or association fact (`isRoomJudge`, `isSponsorRep`).
2. No hardcoded colours (hex/oklch) or off-token spacing in components.
3. No hardcoded user-facing strings — everything through the i18n dictionary,
   all three locales at once.
4. No story IDs, capability keys, or API/database concepts in user-facing
   copy.
5. No shadows on inline surfaces; elevation belongs to overlays only.
6. No second version of a shared component — extend by props or wrap.
7. No mouse-only interactions: no clickable rows without keyboard semantics,
   no hover-only data.
8. No colour-alone state communication, and no toast-only critical failures.
9. No descriptions that restate the title or enumerate visible content;
   no "Soon" badges as attention devices.
10. No UI that makes a locally queued scan look server-confirmed, or an
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
