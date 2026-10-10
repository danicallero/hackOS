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
| [4b. Web page surfaces](#4b-web-page-surfaces-and-interaction-patterns) | Page density, editing, overlay sizes, scroll, save ownership and feedback |
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
view; edition values in `apps/web/src/styles/theme.css`, Tailwind mappings in
`apps/web/src/app/globals.css`.**

Style only with semantic tokens (`bg-background`, `text-muted-foreground`,
`border`, `text-destructive`, …). Colour meaning comes from semantic tones
(`success`/`warning`/`danger`/`info`/`brand`/`neutral`,
`apps/web/src/lib/tones.ts`) — badges, meters, and charts all take a `tone`,
so a colour means the same thing everywhere.

Status washes are translucent, not solid fills. Text on a warning wash uses
the foreground appropriate to the rendered surface: dark text in light mode
and light text in dark mode. Verify normal text against its composited surface
at WCAG AA (4.5:1 or higher), including nested controls such as banner buttons.
Light warning markers derive a darker yellow from edition yellow and ink so
KPI outlines remain visible on cream; warning text retains the normal foreground.

Each row: value → intent → boundary.

| Token group | Value | Intent & boundary |
| --- | --- | --- |
| Spacing scale | 4, 8, 12, 16, 24, 32, 48 px | 8px between tightly related controls, 16px within a section, 24px between sections. Never off-grid values. |
| Accent | one interactive accent | CTAs and active states only. Never decorative, never a background wash. One per view. |
| Error recovery | Brand blue, ink and red | The branded full-page error illustration uses the active edition palette. Do not reuse it for regular warnings or inline errors. |
| Status colours | via `tones.ts` | Reserved for actual state (queue, decision, sync). Never used to make neutral UI "more colorful". |
| Page title | 24/32 Rockwell regular (`type-page-title`) | One per page, in `PageHeader`. Never inside cards. |
| Section title | 18/24 Rockwell regular (`type-section-title`) | Titles a `Section`/`SectionCard`. Not a substitute for the page title. |
| Body | 14/20 regular | Default text. |
| Label | 13/18 medium (`type-label`) | Form labels and control captions. |
| Meta | 12/16 muted (`type-meta`) | Timestamps, counts, secondary facts. **No artificial tracking** — never add `tracking-*` to shared headings or metadata. |
| Data | `tabular-nums` | Any column of numbers. Monospace only for identifiers and timers — never for prose. |
| Controls | 24 px tiny/icon-xs, 32 px compact, 36 px default, 40 px prominent; 6 px field radius, pill buttons | Tiny is for icon-only remove/inline affordances; compact is for dense staff tables; prominent is for mobile-friendly/primary flows. Use component `size` variants, never one-off height utilities. Multiline `Textarea` uses a separate 64 px minimum token. |
| Surfaces | 8 px radius, semantic border + background | **No shadow for inline grouping** — border-only. |
| App frame | 12 px radius, subtle border + small shadow | Desktop navigation is the one floating panel; the main content stays on the shared shell canvas without an outer card. |
| Overlays | 8 px radius; small shadow (menus/popovers), large shadow (modals) | Elevation communicates "floating above the page" and nothing else. |
| Full radius | buttons, status pills, avatars | Not for fields or content surfaces. |

Shared page and section title rows align icons and counters to the visible
capital height (`heading-row`), rather than the different fonts’ line boxes.
Section icons belong in the title row so descriptions never shift them.
Schedule grid lines start after the hour-label gutter; labels use the shell
background to keep the time axis clear in both themes.

Uppercase/letter-spacing is not a hierarchy tool — use scale, weight, and
colour; reserve uppercase for real codes (badge IDs, room codes).

### Edition standard: HackUDC 2027

The web UI follows the [HackUDC 2027 landing](https://github.com/gpul-org/hackudc-2027).
Its [brand guidelines](https://github.com/gpul-org/hackudc-2027/blob/9d51fe26600238fceeebab43e1ca6f902e181bce/BRAND_GUIDELINES.md)
and [CSS palette](https://github.com/gpul-org/hackudc-2027/blob/9d51fe26600238fceeebab43e1ca6f902e181bce/src/styles/global.css)
at commit `9d51fe26600238fceeebab43e1ca6f902e181bce` define this edition.
The landing is an independent Astro application: this repo implements its
identity through the existing shadcn contract, rather than copying its layout.
Changes here do not automatically update that repository or the native app.

There are three layers, with one owner per concern:

| Layer | Owner | Change here for |
| --- | --- | --- |
| Edition | `apps/web/src/styles/theme.css` | Palette, light/dark semantic aliases, typefaces, title weights/sizes, spacing, control sizes, radii, elevation |
| Tailwind/shadcn contract | `apps/web/src/app/globals.css` | Semantic utility mappings (`bg-primary`, `rounded-button`, `font-display`, etc.) and shared type classes |
| Components | `components/ui/*` + `components/common/*` | Accessible structure, behavior, variants and composition; no edition-specific colors |

`components.json` keeps shadcn's `cssVariables: true` and points at
`globals.css`, which imports the edition. Its `baseColor: zinc` is the CLI's
scaffolding preset, not the active product palette. Keep existing components
and Radix behavior; do not regenerate the library to change an edition.
When adding/updating a primitive, preserve this token-backed visual contract.

| Landing foundation | Edition token | Web application |
| --- | --- | --- |
| Ink `#030846` | `--brand-ink` | Text in light mode, primary actions and light outlines; brand accent |
| Cream `#fafafa` | `--brand-cream` | Light canvas/surfaces; dark text |
| Blue `#a3d5ff` | `--brand-blue` | Secondary and active surfaces; dark primary actions |
| Red `#bf2100` | `--brand-red` | Errors and destructive actions; lighter derived destructive color on ink |
| Yellow `#f5dc8f` | `--brand-yellow` | Warning marker/wash, paired with normal foreground text |
| Inter | `--brand-sans` | Body, labels, navigation and dense data; loaded by `next/font` in the root layout |
| Rockwell | `--brand-display` | Page/section/dialog titles and public headlines; supplied regular/bold WOFF2 files in `public/fonts/hackudc-2027/` |

Focus uses `--ring`: ink in light mode, pale blue in dark mode. Never use red
for ordinary field hover or focus; reserve it for invalid and destructive states.

The edition defaults to **light** for new visitors. `next-themes` retains an
existing light/dark/system preference. Dark mode uses a near-black canvas and
charcoal surfaces; fields, cards, buttons and dividers share one subtle border
token in both themes. Edition blue is reserved for interactive accents. Light
mode retains its edition palette. Shared `Input` and `Textarea` controls use
`--field-foreground`: neutral black text in light mode and the foreground token
in dark mode. Native date/time
values also consume this token so Safari follows the same field palette across
all screens (H55). Semantic status roles remain distinct: green is success, red is danger, yellow is
warning, blue is information. Components request `tone`/semantic utilities,
never raw brand swatches or chart-series tokens for status.

Primary buttons use ink/cream in light mode and blue/ink in dark mode.
Secondary/outline interactions use blue-tinted surfaces. Buttons are pills;
inputs/selects retain the compact control radius, inline surfaces remain lightly
framed, and navigation consumes `rounded-frame`/`shadow-floating`. All geometry
comes from the edition, with no changes to staff density. Use flat color blocks;
no decorative gradients, glows or glass on auth/public page surfaces. Keep the
hackOS product wordmark: an event's logo belongs to its configured event identity.

Transactional email applies this edition through an email-safe wrapper
(`notifications/templates.ts`, H52). Correspondence uses red/cream actions
in both themes; this brand accent does not encode acceptance or rejection.
Header and content share the theme's card surface without a decorative top rule.
The email header uses the centered horizontal HackUDC 2027 marketing wordmark
in red for light mail and cream for supported dark-mode clients, using PNG
exports of the supplied edition SVGs (`public/email/hackudc-2027{,-dark}.*`);
the app keeps its hackOS product wordmark. Rockwell headings, sans body
text, pill actions and 8px surfaces retain the edition geometry. The acceptance
heading names confirmation, the primary button confirms, and declining is a
secondary text link. Copy leads with the outcome, shows the exact localized
expiry in the event timezone before the action, then gives consequences or
security notes. See [`notifications.md`](./notifications.md#transactional-email-theme-h7-h52).

### Web button standard

The button audit also reviewed the landing at commit
`5e3b1f743d2bb1e2cc7d7776dcb2a1c113a7cee2`: the header/fixed/sponsor CTAs,
illustrated hero plaques, gallery/media controls, language selectors, social
icons, and text links. The platform retains the palette, Inter labels and pill
actions, adapting the marketing red hover/focus and illustrated plaques to an
operational interface with semantic danger colors and explicit loading states.

`components/ui/button.tsx` and `styles/buttons.css` own action appearance and
interaction. `styles/theme.css` owns `--button-*` state tokens, derived from the
edition's semantic colors. `Button`, `IconButton`, `SubmitButton`, dialog header
actions and `buttonVariants()` share this contract. The public `/design-system`
shows every variant, all six states, all eight sizes, icon-only actions,
link navigation, and working loading demonstrations in es/gl/en and both themes.
Hover/focus/pressed specimens use `data-preview-state` only to display CSS;
this attribute must not be used on product controls or to fake keyboard focus.

| Variant | Purpose | Default appearance |
| --- | --- | --- |
| `default` | One primary action per scope | Ink/cream in light mode; blue/dark text in dark mode; slight shadow |
| `secondary` | Supporting action that benefits from a filled surface | Quiet filled semantic secondary surface |
| `outline` | Supporting action alongside the primary | Canvas surface and a solid, contrasting outline |
| `ghost` | Toolbar, overflow, and low-emphasis action | Transparent surface; text/icon remains visible |
| `destructive` | Confirm a destructive operation | Semantic danger fill; keep `AlertModal` for confirmation |
| `link` | Text action, or navigation composed with `asChild` | Semantic primary text; underline on interaction |

| State | Shared behavior |
| --- | --- |
| Default | A visible label or named icon; stable edition geometry |
| Hover | A small opaque color change; outline strengthens; links underline. Only inside `(hover: hover) and (pointer: fine)`, never required to discover an action |
| Focus | `:focus-visible`, solid 2 px `--ring` perimeter with 3 px separation. Native rows/cells use an inset perimeter to avoid clipping. Forced colors use `Highlight` |
| Pressed | A distinct surface and removal of the primary shadow; links thicken their underline. Pill actions scale to 0.96 for tactile feedback only without reduced motion |
| Loading | `loading={pending}` adds a decorative Phosphor spinner inside the action, preserves its label, sets `aria-busy`, and blocks activation. Existing decorative icons are replaced visually. Loading stays at full contrast |
| Disabled | Native `disabled`, reduced opacity, no hover/press feedback, no shadow, and an unavailable cursor. `asChild` exposes `aria-disabled` and blocks click, auxiliary click and activation keys |

The primary hover visibly lightens the ink fill in light mode and darkens the
blue fill in dark mode; pressed is darker than hover in either theme.
Feedback transitions last 150 ms and target only explicit properties. Reduced
motion removes transitions and press transforms; the loading glyph stays visible
without spinning. Drag handles opt out of press scaling with `button-static`.
Focus follows the platform's ink/blue `--ring`, deliberately adapting the
landing's red-focus suggestion: red stays reserved for invalid/destructive
states in this operational product.

Use `loading` on the action performing a request; a neighboring Cancel or menu
trigger is merely disabled while that request runs. `SubmitButton` maps its
existing `pending` prop into this same primitive; do not hand-code a spinner in
another action. Keep labels specific to the action rather than replacing them
with generic “Loading”. Icon-only actions use `IconButton` with a localized
`label`; loading replaces the glyph without changing the accessible name.

Native composite controls (editable cells, row disclosures, sort headings,
permission segments and picker options) use `button-interaction` for cursor,
hover, pressed and solid focus feedback while retaining their layout and
keyboard model. Shared dialog icon classes consume `buttonVariants`. Official
Apple/Google Wallet artwork stays intact; Google adds an adjacent spinner and
`aria-busy` while fetching its save URL. Do not replace these badges with generic
pill buttons.

```tsx
<Button loading={saving} disabled={!hasChanges} onClick={save}>
  {t("save")}
</Button>
<SubmitButton pending={form.formState.isSubmitting}>{t("save")}</SubmitButton>
<IconButton label={t("remove")} variant="ghost" loading={removing}>
  <TrashIcon aria-hidden="true" />
</IconButton>
<Button asChild variant="outline"><Link href="/schedule">{t("schedule")}</Link></Button>
```

### List filter standard

Use `components/common/filter-menu.tsx` (`FilterMenu`) for management toolbars
with several categorical filters. Users, review history and the schedule use
this shared control instead of one dropdown per property. Keep text search
separate, and keep filtering, persistence and API parameters owned by the page.

- One **Filters** button opens the category menu; desktop categories open
  adjacent submenus. Below 768px, options replace the category list in the
  same panel, with a **Back** action and focus moved into the new panel.
- Single-choice filters declare a `resetValue` and use radio items. Multiple
  choices use checkboxes and keep the menu open while selecting.
- Show selected values as removable chips next to the button. Removing a chip
  clears only that value and returns focus to the trigger. The trigger count
  represents selected values; **Clear filters** resets all categories.
- Use localized category/option labels, Phosphor category icons, and the shared
  shadcn dropdown, button and semantic theme tokens. Menus support keyboard
  navigation and scroll when options exceed the available space.

Form fields still use their appropriate `Select` or searchable entity picker.

### Web icon standard

Use [Phosphor](https://github.com/phosphor-icons/react) via `@phosphor-icons/react`
for navigation, actions, statuses and shadcn primitives. `components.json` sets
`iconLibrary: phosphor` for future generated components. Use native `*Icon` names
and Phosphor's `Icon` type (aliased as `PhosphorIcon` where needed).

Import individual icons from `@phosphor-icons/react/dist/csr/<Name>` inside
client modules and `@phosphor-icons/react/dist/ssr/<Name>` in server-compatible
modules. These direct imports avoid compiling the entire catalogue in Next.js.
Server variants do not read React context; their default weight is `regular`.
Client defaults live in `components/providers.tsx`'s `IconContext`: `regular`,
24 px, `currentColor`. Keep existing `size-*` utilities for contextual sizing:
usually 16 px in controls/navigation, 14 px beside compact metadata, 20–24 px
for prominent states. Use `weight="fill"` for selected dots; preserve `animate-spin`
on `SpinnerGapIcon`. Use `weight`, not Lucide's `strokeWidth`, to change the style.

Icons inherit semantic text colors. Keep decorative icons `aria-hidden` and
give icon-only controls localized accessible labels. Activity registry icon
keys remain stable and map to Phosphor components in `schedule-model.ts`.

### Changing the next edition

1. Read the new landing's brand guidelines. Update the palette and font stacks
   at the top of `styles/theme.css`; add supplied font files and update its
   `@font-face` declarations. A different interface font also needs its loader
   changed in `app/layout.tsx`.
2. Adjust semantic aliases and geometry in that same file when the new brand
   needs a different action/surface hierarchy. Keep the semantic names stable.
   Do not restyle individual management pages or replace shadcn primitives.
3. Preview `/design-system`: it uses real `Button`, `Input`, `Textarea`,
   `TabBar`, `StatusBadge`, `SectionCard`, `DataTable` and `Modal` components,
   with synthetic data and no operational mutations. Check light/dark,
   es/gl/en, narrow/wide layouts, keyboard focus and disabled controls. Also
   inspect real auth, table/form and judging screens for content-specific fit.
4. Run `pnpm lint`, web typecheck/tests and the Chromium UI smoke suite.
   `src/lib/warning-contrast.test.ts` checks WCAG AA text on semantic surfaces
   and status washes, plus a shared field/border token in both themes.
   Capture screenshots outside the source branch per `docs/ui-testing.md`.
5. Update this edition section's reference and the web README in the same change.
   Keep event names, dates, logos and copy in their existing configuration/i18n
   owners; a visual refresh is not a reason to hardcode event content.

The theme is a single **local** source of truth for the web. Synchronizing it
with another repo or native tokens still requires an explicit update; there is
no remote theme fetch or new theme-provider abstraction.

### Authenticated shell aesthetic

**The authenticated product is one quiet operational canvas, with navigation
as its only floating frame.** It should feel composed rather than assembled:
content, header and surrounding canvas share one base tone; hierarchy comes
from spacing, type, borders and the small number of deliberately elevated
surfaces — never from stacking rounded rectangles around every region.

- **One canvas, one floating navigation panel.** `SidebarProvider` and
  `SidebarInset` use the shell tone. The desktop `AppSidebar` uses the
  `floating` variant: a 12 px rounded, subtly bordered panel with a small
  shadow. The content canvas has no outer border, shadow or radius. Do not
  turn the page area into a second card beside the sidebar.
- **The first content surface aligns with navigation.** Wide operational
  surfaces (`data-wide`) keep a small top inset so their first component begins
  on the same horizontal rhythm as the sidebar header. Standard desktop pages
  retain the larger page-header breathing room; on narrow web screens, the
  fixed sidebar control shares the top band and `PageHeader` reserves adjacent
  inline space for its title. The narrow content inset matches the control's
  12px top inset so the title line starts beside the button. Vertical
  separation is earned below the component, not by an arbitrary offset above
  it.
- **Curvature follows ownership.** Fields use the 6 px control radius and
  buttons use the pill radius; inline `Surface`/`SectionCard` groupings use 8 px; the floating sidebar uses
  12 px; overlays use their token-backed 8 px radius. A rounded edge signals a
  bounded, movable or elevated thing — it is not decorative chrome for the
  page canvas.
- **Quiet chrome, clear content.** There is no global workspace bar. The page
  canvas begins with its own `PageHeader`; the desktop sidebar header owns the
  collapse control, while narrow web screens place the same control in the
  fixed leading corner. This preserves vertical space and prevents a second
  title hierarchy from competing with the page `h1`.
- **Depth is scarce.** Inline cards remain border-only. The sidebar, menus,
  sheets and dialogs earn elevation because they sit above or beside the task.
  Avoid background washes, gratuitous shadows and inset outlines that create
  several competing planes.

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
my-queue ticket stub. `schedule/page.tsx` uses the Users `ListToolbar` above its bounded editable
grid. Search, filters and columns share a control row; active chips have their
own row and do not push the filter control out of alignment.
Every dashboard-style panel is a `SectionCard` (#300); a panel that re-builds
title/description/action out of `CardHeader` also re-invents the spacing and
re-introduces the description-restates-the-title pattern.
Public marketing cards may use more whitespace but keep the same radius and
colour tokens.

Use `SectionCard variant="plain"` for open page sections: it retains the
heading, actions and semantic section without a border, background, inset
padding. A quiet heading hairline anchors a titled section; lists may use
hairlines between rows where separate states need clear boundaries.
The title row reserves the compact-control height, so adjacent plain sections
align their hairlines even when only one has an action. A multi-record project
list uses one surface per project to clarify ownership, not nested row cards.
Choose layout and spacing first; a card needs a
bounded unit to justify it. Never put a bordered card around every member or
challenge inside another section. Names, preferences and mandatory flags are
ordinary text, not status pills; reserve badges for meaningful changing state.

### Authenticated navigation

**Navigation explains the available work without becoming another dashboard.**

- The brand is the visual anchor of the header and may be larger than a nav
  row; it is not a second sidebar toggle.
- Render the stable personal destinations first, then one breathing divider,
  then the capability-filtered workspaces. `navigationPersonal` and
  `navigationWorkspaces` are structural labels, not destinations.
- Workspace labels are low-emphasis group headings. They may disclose their
  children, but they never receive the selected-row surface. Only the active
  leaf route gets the active background and inset border. When route prefixes
  overlap, select the deepest matching leaf — never show two selected rows.
- Children revealed by an expanded workspace are indented one navigation level
  (`pl-8`) from their group heading. The indent is structural, not another
  colour treatment; it disappears in the icon rail, where every item returns
  to the shared icon alignment.
- Workspace expansion is independent, not an accordion: opening a different
  category must not close the category containing the current route. Navigation
  changes the selected leaf; it never removes context before the reader has
  moved away from it. Keep exactly the category containing the current route
  plus, at most, the most recently opened category; opening another replaces
  that secondary expansion.
- Expanded children animate as one compact disclosure (height, opacity and a
  2 px settle) rather than appearing row by row; collapse is slightly faster
  than expand. The chevron follows the same motion, and all of it disables for
  `prefers-reduced-motion`.
- Use vertical breathing room around category changes and workspace headings;
  do not solve categorisation with repeated heavy dividers or all-caps labels.
  In the collapsed icon rail the labels reduce to non-interactive separators
  and every destination remains directly reachable.
- The footer is an account utility row: identity is text-first (name and email,
  no fabricated initials or fallback avatar); the appearance control sits at
  the row's trailing edge. The account menu contains Profile, the quick
  language switcher, and Sign out. On the icon rail, text can hide but the
  account action remains a labelled icon.

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
- **The page carries its own name.** There is no global workspace title bar;
  every destination has one `h1` in its `PageHeader`. Navigation communicates
  the containing workspace, so never add a second, competing page title.
- **Persistent utilities belong in the navigation footer.** Account and
  appearance controls stay together below navigation; language is a quick
  setting in the account menu. The top bar is reserved for orientation and the
  sidebar control.
- **Keep return navigation direct.** Project detail headers provide a labelled
  back arrow to their project list. Do not hide this primary return path in an
  overflow menu. Other records retain browser history and sidebar navigation.
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

## 4b. Web page surfaces and interaction patterns

**The page is a composition, not a stack of cards.** Start with the task,
reading order and scroll owner, then choose boundaries. The runnable contract
is `/design-system` → Page patterns; `PageLayout`, `PageHeader`, `PageToolbar`,
`SearchField`, `ListToolbar`, `SectionCard`, `TabBar`, `FormActions`, `Modal` and `SidePanelEditor` are the
shared implementations. Geometry lives in `styles/surfaces.css`.

### Choose the page before choosing its containers

| Task / real web examples | Composition | Width / scroll |
| --- | --- | --- |
| Scan, filter, compare, select: Users, Applications, Audit, Projects, Challenges, Enterprises, Activities and Accreditation/Presence | Header → optional tabs → search/filter toolbar → count/selection feedback → one table or drill-down list → pagination | `PageLayout` (content), max 1280 px, matching Users. Use `workspace` only when columns require more space. Document scroll. Never constrain a table tab to the width of its sibling form. |
| Read or edit one subject: challenge editors, compact catalogues | Header → optional category tabs → open sections → one save owner per form | `PageLayout width="reading"`, max 896 px. Fields themselves stay in one or two readable columns; never stretch a single text field across a wide dashboard. Document scroll. |
| Operate live data: queue operations, schedule grid, logistics analytics | Header → compact scope/data controls → operational surfaces | `width="workspace"`, available shell width. Document scroll unless simultaneous panes require a fixed workspace. |
| Judge while watching queue and evaluation | Header/scope controls → sibling panes; queue and evaluation are separate bounded units | Existing judging desktop breakpoint (`xl`): fixed viewport, `min-h-0` throughout, scroll only pane bodies, fixed pane actions. Below it, normal document flow. No page-scroll trap on small/zoomed screens. |
| A small amount of content | Same header and alignment, open content and useful next action | Do not center everything vertically, inflate cards or add filler descriptions. Empty space is acceptable. |

Application management and user/enterprise detail use the same 1280 px content
canvas as Users. A full route page does not mean unlimited
width: user detail needs its own route, header and tabs, not a stretched canvas
or a side editor. Libraries use the 896 px reading canvas. Profile, project details and event
settings use the 1280 px content canvas: desktop columns group personal details
and account utilities, project content and challenges, or category navigation
and settings. Keep individual form fields and descriptions readable within
that canvas. These contexts use bounded SectionCard surfaces with plain rows
inside; avoid nested cards around each person, link or challenge. Neither route name nor settings category chooses width.
Activities and Accreditation/Presence share this 1280 px canvas, including
their tabs and control alignment. A scanner may be compact within that canvas;
it does not give the destination a different outer width.
Reserve the workspace canvas for simultaneous operational panes or columns that
actually need more room. Restrict individual text/form groups, never table tabs. Verify the last column is visible at
normal desktop widths before accepting a layout. Horizontal scroll is for a
genuinely narrow viewport or an exceptionally wide operational grid, not an
artificial reading-width container.

The shell supplies horizontal margins (16 px mobile, 24 px from `sm`) and top
clearance. Page blocks share a 24 px rhythm. Within a block use 16 px, between
closely related values/controls use 8 px; independent form groups may use 32 px.
Align labels/control tracks, not the bottom of helper text. Rows and tables
retain their compact established density. Do not add a second inset wrapper
around a `PageLayout` or override its width for visual guesswork.

### Reusable compositions and ownership

Use the app composition layer over shadcn/Radix primitives. The primitives own
keyboard navigation, focus, portals and control behavior; compositions own
alignment, width and slots. Pages retain domain queries, permission checks,
URL state, validation and mutations. Do not duplicate primitive behavior or
build a universal page component with domain flags.

| Component | Shared contract |
| --- | --- |
| `PageLayout` | Content 1280 px, reading 896 px, or a genuinely wider operational workspace. One canvas; shell owns viewport padding. |
| `PageHeader` | One page title with optional real identity, metadata/state and page actions. |
| `SearchField` | Labelled search input, decorative search icon and accessible clear action that returns focus to the input. |
| `ListToolbar` | Users-style broad search, shared `FilterMenu`, trailing view/export actions and optional feedback; active chips occupy a separate row. |
| `PageToolbar` | Lower-level labelled control region for specialized operational controls that do not fit the list composition. |
| `TabBar` | One segmented selector using Radix Tabs. `full` distributes width; `content` hugs labels. Same selection/focus behavior. |
| `SectionCard` | Common heading/state/actions/body; `plain` for related open sections, bounded default for independent objects. |
| `FormActions` | Actual save status first, secondary actions then Save last; one pending spinner, owned by the submit button. |
| `Modal` / `AlertModal` / `SidePanelEditor` | Shared geometry and focus/close behavior; content-driven size. Domain dirty/pending guards remain with the editor. |

Users and application responses consume `ListToolbar`; the generic `DataTable`
uses `SearchField` within `PageToolbar`. Event settings and profile share
`FormActions`. Specialized compositions may differ in content while retaining
these same controls and alignment contracts. The playground uses the actual
components and local synthetic operations, so examples can be interacted with.

### Form builders and selection groups

A builder distinguishes ownership from presentation: a section bounds its
questions; each question has a compact toolbar (drag handle, field type and
secondary actions) above its editable content. A subtle dashed section boundary
is a drop destination, not an extra decorative card. Empty sections keep a
visible destination. Use the existing Stats/questionnaire drag primitives,
keyboard sorting, placeholder and floating preview rather than a second drag
interaction. The section title editor is its header, with the handle beside it;
never repeat it in a second title bar. A question opens from its whole card,
while controls and drag handles retain their own interaction. Expanded editing
does not duplicate a disabled answer preview; the explicit Preview action
shows the applicant form. Respect reduced motion and keep input interactions separate from
the drag handle. Standalone questions can live before all sections or after a
section: `after_section_key` persists that anchor without assigning ownership.
It is mutually exclusive with `section_key`. Builder, preview, applicant form
and reviewer use the same ordering. A drop zone after a section clearly names
that outside position. Removing a section clears its ownership and anchors.

The reviewer file viewer uses the same dnd-kit sensors, handle, source-size
preview and reduced-motion drop feedback as the builders. Docking is a fixed
viewport interaction, so it does not scroll the page while crossing panes.
The adjacent modal previews its new position during drag; Escape restores the
committed position. Keep the viewer's empty state available.

Status filters allow multiple values. Within a status group, selections are
combined with OR; independent groups and the search query combine with AND.
No selected status means all statuses. Show removable filter chips and a clear
reset; do not silently replace one selection with another.

On narrow application lists, show one readable record row with identity, status
and relevant metadata instead of requiring a horizontal scroll through a single
record. Keep bulk selection separate from the button that opens the record.
Group related exports under one labelled menu; two identical download icons
without context are not an adequate mobile adaptation.

### Headers, controls and tabs

- A destination has one `PageHeader` and one `h1`. Title and data start at the
  same edge; the mobile header reserves the sidebar trigger. The header has
  no colored band, border, shadow or surrounding card. Use the same hierarchy
  for lists and records. Keep the title visible when its actions wrap.
- No decorative page symbol by default. `leading` is a real record identity
  (logo/photo); section icons are optional scanning aids when several distinct
  domains appear together, not mandatory decoration. Never fabricate avatars.
- Status belongs next to the subject it describes. A count is neutral text
  with tabular numerals; email/date/ownership are metadata. A description only
  earns space when it explains policy, risk, consequence or an unfamiliar state.
- Header actions affect the page/record. `PageToolbar` controls affect the data
  immediately below. Search first, filters next, view/column settings last.
  On mobile they wrap or become labelled icon controls; filter chips occupy
  their own horizontally scrollable row. Never hide the only way to clear filters.
- Selection actions replace/augment the data toolbar only while selection
  exists, with its count. A row's actions belong to its trailing cell/menu;
  avoid a second primary action competing with page creation.
- `TabBar` uses the statistics selector's segmented treatment everywhere.
  `width="full"` (default) distributes tabs across the useful width;
  `width="content"` hugs the tab labels and leaves room for adjacent controls.
  Width is the only visual variant; never reintroduce an underlined second style. Tabs select sibling
  views of the same subject; they are not headers, filters, or action buttons.
  Keep the page header above them. The selected tab already names the panel:
  do not repeat it as an immediate `h2`; give distinct subsections their own
  headings. Statistics phase uses `width="content"` in its control row. Use a route for a different subject/workflow.
- Tabs stay on one scrollable line; never wrap or clip their last item. Event
  settings does not add a second vertical rail beside the app sidebar:
  `/settings/event` is a plain list of the sections the caller may manage, and
  `?tab=<section>` opens one section with a back link in the header context slot; a section's own views
  stay horizontal tabs. The same layout serves desktop and mobile. Use
  meaningful labels and keyboard arrow navigation. Deep links, per-category save
  scope and the dirty-section guard (links, browser Back and unload) are
  retained (#932).

### Creation, reading and editing

| Interaction | Surface and behavior |
| --- | --- |
| Create/edit one bounded record from a list (room, schedule item, invite, announcement) | `SidePanelEditor`; retain list filters/selection/scroll behind it. Its header and action footer stay fixed, its body scrolls. One save/submit owner. |
| Short creation with a few related fields, a decision, or acknowledgement | `Modal` only if it fits a short interaction. A modal is not a miniature settings page. |
| Destructive or irreversible operation | `AlertModal`, name the target and consequence; cancel is secondary, only confirmation is destructive. |
| Multi-section creation/editor, deep detail, version history, shareable workflow | Dedicated route, e.g. challenge creation, project details and application builder. Navigate with a real link where possible; keep native browser history useful. |
| Secondary explanation/detail attached to a section | Explicit inline disclosure. Large expansion/collapse preserves the trigger's viewport anchor. |
| Supplementary information on pointer hover | Tooltip for a short nonessential label, or a focus/click-operable popover. Never put required data, row actions, editing or the only explanation of an error behind hover. Touch uses explicit activation. |

Creation and editing share field ordering and save behavior; editing pre-fills
existing values rather than introducing a second custom form layout. A panel
may contain open groups, never stacked bordered cards for every field group.
Keep actual multi-record objects independently bounded when ownership matters.

### Overlay geometry and content ownership

- The live statistics activity chart can expand to the viewport minus 32 px,
  using the shared modal focus and close controls. This is a focused read-only
  chart view, not a record editor.
- Modal `sm`: 384 px, short confirmations/decisions; `md` (default): 512 px,
  compact forms. `lg`: 672 px, exceptional paired fields/review content; `xl`:
  896 px, existing specialized review tools only. Larger sizes are not a
  license to move a route into a dialog. Width is always capped by viewport
  minus 32 px, height by `100dvh - 32px`; body is the only scrolling region.
- Side editor sizes: `default` 512 px for a compact record; `wide` 672 px for
  paired fields / rich text (Schedule and Announcements); `expanded` 896 px
  for an editor with a genuine adjacent preview. Choose by content, not by
  making every panel wider. Deep multi-domain records such as user detail
  stay full route pages (`PageLayout`, 1280 px content canvas), never side editors.
  All panel sizes use a desktop inset of 12 px on top/bottom/trailing edge and
  8 px overlay radius. Below `sm`, full viewport width and `100dvh` height,
  no decorative gap or rounded desktop frame. Body has 20 px padding; header
  and actions stay outside its scroll. Footer respects the bottom safe area.
- Both use the shared overlay/backdrop, close affordance and focus management.
  Clicking outside, Escape, X and Cancel all dismiss through the same open
  change handler and restore focus to the trigger. Alert confirmations treat
  a backdrop click as Cancel; it never executes the destructive action.
  A pending confirmation cannot dismiss while its mutation is in flight. A dirty editor must not silently
  discard input: retain it or use the existing discard guard. Pending writes
  cannot submit twice. Do not automatically close on a failed save.
- Essential header controls wrap in header flow on narrow screens rather than
  covering the title. Menus/comboboxes use the nearest overlay scope and keep
  their keyboard behavior; no hand-built nested portals or stacked editor modals.

### Persistent actions and save feedback

| Situation | Action placement / feedback |
| --- | --- |
| Short form fully visible with its submit action | Normal-flow footer. No floating bar needed. |
| Long page editor/settings category | Sticky footer inside the owning form/section (`stickyFooter` / `.form-action-footer`), opaque surface and top hairline. Save and persistent `SaveStatus` travel together. Respect safe areas and allow focused final fields to scroll clear. |
| Side editor / fixed operational pane | Fixed footer outside the scrolling body; no nested sticky bar. |
| Long, frequently extended operational table | Keep its existing compact trailing sticky create action (Schedule/Rooms). Do not add a floating create button to every short/paginated catalogue. |
| Immediate cell edit / autosave | Show saving/saved/error at the cell or its shared scope, not a page-level claim that unrelated data is saved. |

`FormActions` places the scope's current save status at the leading edge;
secondary actions (Cancel/Reset) and the primary Save follow at the trailing
edge, with Save last. At narrow widths the groups wrap without changing this
reading order. The button owns the pending spinner; the adjacent state text
does not duplicate it. Autosave without a button keeps its own indicator.
This is the shared action-bar anatomy, not a per-page choice.
The initial loaded data is saved; a real edit becomes unsaved; request start
becomes saving; only a successful response becomes saved. Failure retains the
input and shows an inline error, plus optional toast. Never show saved merely
because the button was clicked. A category's sections share one form,
transaction and dirty guard; independently saved resources retain their own
owner. Do not attach an independent save button to each cosmetic subsection.
Unsaved navigation uses the established guard. Conflict/offline feedback may
only claim these states when the underlying save flow detects them; it must
explain the available retry/reload path, never silently overwrite another edit.

### Cards, rows, badges and feedback

- Use an open `SectionCard variant="plain"` for related content or fields on
  the same subject; spacing and headings supply hierarchy. Use a bounded
  surface for a selectable object, an independent operational pane, comparative
  table, metric or object with a distinct lifecycle. Use `StatCard` for a metric.
- No card inside a card merely to label a subsection. Use open groups, rows,
  inset spacing, or a quiet hairline/wash when ownership needs a boundary.
  A headerless `SectionCard` must not render an orphan top separator.
- Badges communicate a meaningful categorical state (pending, confirmed,
  published, paused, conflict), with a localized label and semantic tone.
  Static names, dates, preferences, roles listed as metadata, mandatory flags,
  descriptions and quantities are text. Filter chips are controls, not badges.
  Never rely on color alone or turn every attribute into a pill.
- A collapsed object has a visible disclosure control; essential state and
  next action stay visible. Actions inside a row stop row navigation and stay
  keyboard/touch reachable. Hover can strengthen affordances, not reveal the
  only route to the action.
- Toasts acknowledge completed actions without moving focus. Brief success
  may arrive compact; supplementary detail can expand on hover/focus. A toast
  with an action opens expanded and stays long enough to discover/use it;
  a long/essential explanation opens expanded too. Touch must not need hover.
  Use an action only for a real Undo, Retry or relevant destination. No pretend
  Undo for an irreversible operation. Critical failure, conflict and partial
  batch results remain inline/durable; a toast is never their only channel.
- Toast headings identify the action, bodies explain the outcome. Reuse the
  shared adapter's queue limits, reduced motion, focus behavior and localized
  copy. Do not add per-page toast renderers.

### Audit coverage and maintained exceptions

The shared page canvas is applied across the list, record, settings, participant,
sponsor, audit, logistics and queue routes. Users retains its audited desktop
layout; its toolbar now has the common semantic boundary. Event/profile forms
use persistent save ownership; challenge editors and application settings use
open sections and the common sticky footer. Announcement editor groups are
open inside the side editor. All shared modals/panels consume the same geometry,
and all shared category tabs use the same presentation.

Judging deliberately keeps its fixed desktop split workspace. Permissions keeps
its role tree/editor split. Verification keeps a small centered acknowledgement;
public/auth pages and TV/kiosk surfaces have their own existing contracts.
Specialized application-review tooling retains its dedicated rich review modal
and file viewer; this does not establish a default for new detail workflows.
Its desktop file viewer shares Statistics' dnd-kit sensors, grip, full-size
DragOverlay, destination placeholder and reduced-motion policy. Dragging previews
the destination and moves the adjacent modal to make room before drop; cancel
restores the committed position. Keyboard Space/Enter picks up and drops,
Left/Right chooses a side and Escape cancels the drag without dismissing the
review. File fields retain their empty viewer slot when no file was uploaded.


Validate any change with multiple adjacent records, empty and filtered states,
loading/error/saved/dirty states, keyboard and pointer, both themes, and desktop
and narrow screenshots. Shared geometry is not evidence that every domain flow
has identical semantics: preserve permissions, state transitions, draft scope,
and specialized operational behavior.

## 5. Component decision logic

**Summary: the shared library is canonical — pick by job, extend by props,
never fork. Decide *whether* something is a dialog before deciding *which*
dialog. Inventory: `apps/web/README.md`; representative live examples in
`/design-system`.**

Shared dialogs and sheets (H55) use the shadcn New York/Radix backdrop:
`bg-black/50`, without backdrop blur. Dialog content uses the opaque `bg-popover`
surface so underlying page text cannot interfere with the dialog. Both backdrop and content use
`z-index: 50`; the portal renders the content after the backdrop.

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
| A focused record editor that benefits from keeping the parent list visible | `SidePanelEditor` | A modal that turns into a scrollable mini-page |
| One short decision, confirmation, or small form | `Modal` / `AlertModal` | A route for a two-field form |

Two smells that mean a dialog has outgrown itself: it scrolls internally on a
laptop, or it contains its own tabs, its own list *and* its own form. Both mean
it should have been a route.

### Side-panel editor anatomy

**A focused editor is a companion to the current page, not a replacement for
it.** `SidePanelEditor` opens from the right on desktop with an inset, rounded
sheet, preserving enough of the parent list or workspace to maintain context.
Its title/description header and action footer stay fixed; only the form body
scrolls. The trigger belongs at the trailing edge of its action group so the
direction of travel (page → panel) is visually predictable. On narrow screens,
the same primitive may use the platform's full-height sheet behaviour rather
than squeezing a desktop panel into the viewport.

**Never put a table, a live-updating list, or a record's primary content in a
dialog.** A queue, a roster, a set of results are things people scan, sort and
return to; behind a modal they can't be linked, shared, or kept open next to
anything else.

### Which component

| Job | Use | Not |
| --- | --- | --- |
| Confirm an irreversible/destructive action | `AlertModal` | `Modal` with a red button, `window.confirm` |
| A short, self-contained dialog that passed the test above | `Modal` (controlled or `trigger`) | Hand-rolled Radix Dialog; anything the table above sends to a route |
| A single-record editor opened from a list or workspace | `SidePanelEditor` | Recreating a right sheet's focus, close, header and footer behavior in a route component |
| Report a failed load/submit in place | `ContextualError` (+ retry) | A toast alone |
| Confirm a completed action | Toast (Sileo) | A modal interrupting the flow |
| Communicate entity status | `StatusBadge` with a `tone` (queue states: `QueueStatusBadge`) | Coloured text, custom pills |
| A metric | `StatCard` (delta/footer slots for meters/sparklines) | Bare big numbers in a `Surface` |
| Comparative data, sorting, bulk selection | `DataTable<T>` | Custom table markup |
| A horizontal tab bar | `TabBar` (scrolls itself when the triggers outgrow the container) | Bare `TabsList` with a per-page `overflow-x-auto` wrapper or `flex-wrap`, which the fixed pill height clips |
| A group of adjacent actions | `ActionGroup` (wraps with the shared 8 px gap) | Repeated per-page flex/gap wrappers with divergent wrapping |
| An icon-only action | `IconButton` (localized `label`, token-backed hit area) | A bare `<button>` or `Button` with a hand-written `size-*` override |
| A combobox/multi-select inside a `Modal` or `SidePanelEditor` | `MultiSelect`/`UniversityPicker`/`UserPicker`/`EntityCombobox` with `inDialog` | The same control without it — its list then either can't scroll or spills outside the overlay |
| An interactive overlay inside another overlay | Use the shared `DropdownMenu`, `Select`, or `Popover`; their content stays in the nearest overlay scope. Give a common combobox `inDialog` so its list uses the same scope | A body-ported child that steals focus, clips, or makes the parent dismiss when its trigger is clicked again |
| Pick one row from a table-backed list (users, enterprises, activities, …) | `UserPicker` (server-searched) or `EntityCombobox` (client-filtered, already-fetched list) | A `Select` dumping every row flat — unusable once the table grows past a handful of rows |
| A set of same-shaped objects users drill into (esp. mobile) | Cards / drill-down list rows | A horizontally scrolling table |
| Zero-state | `EmptyState` with one direct CTA | Prose explaining where to navigate |
| Long-form save feedback | `FormActions` + `SaveStatus` (`lib/save-state.ts`), sticky within the owning form | Silent autosave, per-section save buttons |
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
- Wide operational tables preserve readable column widths and scroll
  horizontally instead of compressing every field into an overlapping grid.
  Long free-text cells truncate with a native title, while row actions stay in
  a stable trailing column. Primary create actions for a table align to that
  trailing edge, close to the side-panel origin.
- User tables stay text-first when no profile image exists; do not synthesize
  initials into avatar circles, which adds height without adding identity.
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
- Sidebar workspaces share one list with 4 px between destinations, matching
  the personal menu. Keep section spacing outside that list; do not add top
  margins to individual workspace headers. Expanded child links have a 4 px
  gap below their header.
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
   Toast headings name the action/event in two or three words (for example,
   “Añadir reto”). Use a single line for simple actions, confirmations and brief
   errors. Reserve title + expanded body for long messages or specific failures
   needing an explanation, and define a contextual heading for long
   feedback in all three languages. Never use a generic failure as a substitute
   for reviewing the operation's copy.
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
| "Venue preview", "Pass preview" above an obvious configuration preview | Omit the eyebrow; retain labels that distinguish front/back or real/draft state |
| "Upload a standard logo and, optionally, an alternate logo…" above upload buttons | Omit; the upload buttons and fallback hint explain the choice |
| "No applications yet" + "This user hasn’t started any application form" | Keep only the empty-state title |
| "Choose a mode" below "Display mode" | Keep a screen-reader legend; omit the repeated visible heading |
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
- Landing-derived, light-first edition identity; light and dark both fully supported
  via `next-themes` — every screen must read correctly in both.
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
- The `/design-system` route previews the shared theme on representative
  primitives and widgets — check it before building UI.
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
    destinations. Queue remains visible before the first queue entry so its
    empty state can explain what to expect and expose the tutorial.
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
- A successfully authenticated account without role-derived mobile/event
  access is signed out and receives one native modal alert with a clear
  dismissal action. This access boundary must not be represented only as
  transient inline copy.
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
| Edition colour/radius/type tokens | `apps/web/src/styles/theme.css` |
| Tailwind token mapping and type classes | `apps/web/src/app/globals.css` |
| Interactive component preview | `apps/web/src/app/(public)/design-system/page.tsx` |
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
   capability or association fact (`queue:status`, `isEnterpriseJudge`,
   `isSponsorRep`).
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
