# @hackos/web

The hackOS web frontend — Next.js (App Router) + shadcn/ui, styled in the same
dark-first family as **Dokploy**. It consumes the Fastify API (Better Auth
included) and follows the same user stories (`plan/historias-hackos.md`) as the
backend, one workstream at a time.

> **The web app is its own deployable service behind its own Traefik router.**
> It is never served by, or routed together with, the API. See
> `deploy/services/web` and the `web` service in `deploy/docker-compose.yml`.

## Stack

- **Next.js 16** (App Router, RSC, Turbopack), **React 19**, TypeScript.
- **Tailwind CSS v4** with CSS-variable theme tokens.
- **shadcn/ui** (new-york style, zinc base) as the primitive layer.
- **Better Auth** browser client (`better-auth/react`) against the API's
  `/api/auth/*`.
- **react-hook-form + zod** for forms, **sonner** for toasts,
  **next-themes** for light/dark, **lucide-react** for icons,
 **qrcode.react** for locally-rendered QR codes, so QR payloads never need to
  travel to a third-party image service.
- `@hackos/shared` for the capability catalogue and SSE event contract — the
  same single source the API uses.

## Local development

```sh
pnpm dev            # from the repo root: API on :3000 + web on :3001
pnpm dev:web        # web only
pnpm --filter @hackos/web build      # production build
pnpm --filter @hackos/web typecheck  # tsc --noEmit
pnpm --filter @hackos/web test       # vitest — colocated *.test.ts(x) unit tests
pnpm test:ui:browser                 # Playwright browser + responsive mobile run (root)
```

The browser UI suite lives in [`../../e2e/browser`](../../e2e/browser) and its
full setup is documented in [`../../docs/ui-testing.md`](../../docs/ui-testing.md).
Use accessible roles and names in browser tests. When a flow must remain stable
across the web and native clients or across locales, add a shared contract to
`@hackos/shared/ui-test-ids` and wire it to `data-testid`/`testID` at the
interactive control.

Config: copy `.env.example` → `.env.local`. `NEXT_PUBLIC_API_URL` is the API
origin (default `http://localhost:3000`). Because the web and API are different
origins, the API must trust the web origin in **two** places:

- `CORS_ORIGINS` (API env) — browser CORS.
- Better Auth `trustedOrigins` — derived from `CORS_ORIGINS`, plus
  `http://localhost:3001` automatically in dev. Without this Better Auth 403s
  sign-in with `Invalid origin`.

To point the local web at a **deployed** API, set `NEXT_PUBLIC_API_URL` to that
host and make sure the deployment includes your web origin in `CORS_ORIGINS`
(and is running this branch, so cross-site session cookies — `SameSite=None;
Secure` in production — are enabled).

## Directory layout

```
src/
  app/
    (auth)/            unauthenticated flows — centered card shell (H1–H5)
      login, signup, forgot-password, reset-password, verify-email,
      claim-account, applications (public application form)
    (app)/             authenticated shell — sidebar + top bar, AuthGuard
      personal area (my-applications, my-project, my-queue, wallet, inbox,
      schedule, settings/profile — no dashboard/home page, schedule is the
      landing destination) · staff workspaces (applications, projects,
      challenges, enterprises, queue, judging, logistics, announcements,
      timetable, tv, users, permissions, audit, settings/event) — one
      directory per module, gated by capability
    layout.tsx         root: fonts + <Providers>
    page.tsx           routes to /timetable or /login by session
  components/
    ui/                shadcn primitives — GENERATED, do not hand-edit
    common/            reusable app widgets (the shared library, below)
    layout/            app shell pieces (sidebar, user menu, guards, banners)
    public/            surfaces rendered outside the authed shell (schedule
                       timeline, countdown, PublicScheduleView) — when a page
                       exists in both an authed and a public shell, the module
                       lives here and each route keeps only its shell
    providers.tsx      theme + session + tooltip + toaster
  lib/
    api.ts             credentialed fetch wrapper → ApiError
    auth-client.ts     Better Auth browser client
    session.tsx        SessionProvider + useSessionContext/useMe/useCan
    nav.ts             sidebar model: PERSONAL_NAV + capability-gated
                       WORKSPACES — extend per module (docs/navigation.md)
    i18n.ts            i18next wrapper — copy lives in packages/shared/locales (see Conventions)
    tones.ts           semantic tone → theme-token class mapping
    types.ts           API DTOs (Me, …)
    env.ts, utils.ts   config + cn()
    <domain>.ts        per-domain helpers/models (queue.ts, projects.ts,
                       logistics.ts, judging-workspace.ts, …) with colocated
                       *.test.ts(x) run by `pnpm --filter @hackos/web test`
```

## The component library — reuse, don't recreate

Three layers, most-specific wins. **Before building UI, check these in order
and reuse what exists.** Add to the shared layers rather than duplicating.

### 1. Primitives — `components/ui/*` (shadcn)

Generated by the shadcn CLI; treated as vendored. Add more with:

```sh
pnpm dlx shadcn@latest add <name> -y
```

Don't hand-edit them (biome ignores this dir). If a primitive needs a project
variant, wrap it in `components/common/`.

### 2. Shared widgets — `components/common/*`

App-level building blocks used across every screen. Reuse these instead of
re-implementing. Each is a **single canonical component configured by props**
— never fork a second version. Full inventory with variations:
`/components` in the running app.

Key components: `PageHeader`, `SectionCard`, `StatCard`, `StatusBadge`,
`EmptyState`, `DataTable`, `TabBar`, `Modal`, `AlertModal`, `ContextualError`,
`CapabilityGate`, `AccessDenied`, `Spinner`, `SubmitButton`, `PasswordInput`,
`QrCode`, `MultiSelect`, `TemplateFieldControl`, `FileUploadField`, `UserPicker`,
`EntityCombobox`.

Popovers (`MultiSelect`, `UniversityPicker`, `TimezonePicker`, `UserPicker`,
`EntityCombobox`) take an `inDialog` prop: inside a `Modal` it portals the list
into the dialog panel via `useDialogPortal`, which is the only place that is
both inside the dialog's scroll-lock and outside the modal body's scroller.
Pass it, or the option list either refuses to scroll or spills past the dialog
edge.

**Picking a user or an entity from a list — don't hand-roll a `<Select>`.**
`UserPicker` is a type-ahead combobox over a server-searched user endpoint
(`/api/users`, `/api/projects/member-candidates`, …) — pass it a `search`
function, it debounces and renders results in a `Command` popover.
`EntityCombobox` is the client-side-filtered counterpart for a list you've
already fetched in full (enterprises, activities): pass `options`, `getId`,
`getLabel`. Reach for a plain `Select` only for small, fixed, non-growing
option sets (enums, status filters); anything backed by a table that a staff
member could plausibly type into a search box should use one of these two
instead — a flat `<Select>` over dozens/hundreds of rows is unusable.

A capability-denied page is `<AccessDenied ask={t("…")} />` and nothing else —
one heading for every page, one per-page ask naming the access to request. It
renders; it does not gate. The page keeps its own capability check.

**TV surfaces** (`app/(public)/tv/*`) are their own layer with their own rules —
one screenful, `em` sizing off a measured scale, nothing that needs hover or
scroll. See [`docs/tv-screens.md`](../../docs/tv-screens.md) and §11b of
[`docs/DESIGN.md`](../../docs/DESIGN.md) before touching them.

**Tones & colors.** `lib/tones.ts` maps semantic tones
(`success`/`warning`/`danger`/`info`/`brand`/`neutral`) to theme-token classes.
Badges, meters and charts all take a `tone`. Never hardcode a hex.

### 3. Layout — `components/layout/*`

`AppSidebar`, `UserMenu`, `AuthGuard`, `VerificationBanner`, `HeaderTitle` — the
authed shell. `HeaderTitle` shows the *workspace* the route belongs to
(`workspaceForPath` in `lib/nav.ts`), never the nav leaf: the page renders its
own name in its `PageHeader` `h1`, and one destination gets one name, so
`nav.ts` and the page `h1` share a message key.

## Page structure — when a page becomes a directory

Most routes are a single `page.tsx`. Some grow into a directory of colocated
files. The rule below exists so that when that happens, every page grows the
*same* shape — three differently-organised directories are worse than three
large files.

### When to split

**The trigger is meaning, not length.** Split when the page contains parts that
are independently meaningful — a tab with its own state and save cycle, a modal
with its own form, a decision rule you'd want to test without rendering
anything. A route whose sections only make sense together stays in one file
however long it is.

Line count is a **prompt to look, not a mandate to act**. Past roughly 600
lines, open the file and ask whether the meaning test above is met; if it
isn't, leave it alone. Mechanically shredding a cohesive 700-line page into
eight files that each need six props threaded in makes it harder to read, not
easier. `settings/event/` (10 files) is split because each tab is a real,
separable unit — not because it crossed a number.

### What goes where

```
app/(app)/<route>/
  page.tsx            the route itself: data loading, top-level state,
                      capability gates, composition. Nothing else.
  <thing>-tab.tsx     colocated presentational pieces — kebab-case, one
  <thing>-card.tsx    component per file above ~150 lines. Private to the
  <thing>-modal.tsx   directory: not re-exported, not imported from another
                      workspace.
  <domain>.ts         pure decision logic + colocated <domain>.test.ts.
  <domain>.test.ts    No JSX, no fetching — input → decision.
```

- **`page.tsx` stays the route.** If something in it isn't loading data,
  holding top-level state, gating on a capability, or composing children, it's
  a candidate to move out.
- **Logic modules are the part that pays.** `judging-workspace.ts`
  (`workspaceAccess`, `collaborationState`, `hasWaitedTooLong`),
  `applications/workflow.ts`, `logistics/stats/model.ts`,
  `challenges/[id]/version-history.ts` — each is a sibling module with a real
  test, extracted because the rule was worth asserting, not because the file
  was long. Do this one first; it's the only part of a split that adds
  coverage.
- **Where the logic module lives.** Next to the route it serves
  (`applications/workflow.ts`). A sibling route may import it by relative path.
  Promote to `src/lib/` only once it's genuinely cross-workspace
  (`lib/judging-workspace.ts`, `lib/queue.ts`).
- **Plain file names, no `_` prefix.** Next.js treats both as non-routes inside
  `(app)`; the codebase has zero underscore-prefixed files and that's the
  choice. Only `page.tsx`, `layout.tsx` and `[param]/` directories carry
  routing meaning.
- **`components/common/*` requires a second consumer that exists today.**
  Reuse is demonstrated, not anticipated. One-surface components stay in the
  route directory.

### What must not be extracted

Two smells, both of which make the codebase worse while looking like progress:

1. **The single-use 20-line helper.** A small presentational fragment used once
   in the same file is not a component — moving it just adds an import and a
   file to open. Inline it.
2. **Prop-drilling to survive the move.** If pulling a piece out means
   threading six props (or lifting local state up so it can be passed back
   down), the piece isn't separable — its state and its markup belong together.
   Leave it.

### Splitting an existing page

Splits are **behavior-neutral moves**: no prop-shape changes, no logic edits,
no styling tweaks in the same commit. If you find a bug mid-move, file it and
fix it separately. Keep hunks contiguous so `git diff -M/-C` reads them as
relocations, and do one page per PR.

### The size guard

`pnpm check:pages` (in `pnpm lint`) measures every `page.tsx` and reports two
tiers:

- **Past 600 lines** — listed, does not fail. This is the "open it and apply
  the meaning test above" prompt, not a verdict. Plenty of pages live here
  legitimately.
- **Past 950 lines** — fails. A **ratchet**, not a target: it sits just above
  the largest page that existed when the guard landed, so nothing can get
  worse than the worst thing already in the tree. Lower the number as pages
  shrink.

There is deliberately **no allowlist**. A file that "needs" an exemption means
the limit is wrong — change the number, don't special-case the file, or the
list turns into a dumping ground and the guard stops meaning anything.

## Conventions (match the backend's discipline)

- **Trace stories.** Reference the story id (`H7`) in commit messages and
  non-obvious comments, exactly like the API.
- **Gate by capability, never role (H8/H55).** Use `useCan(cap)` /
  `<CapabilityGate>` / `nav.ts` entries. `me.role` is illustrative display
  only. The API still enforces every route — UI gating just hides what a user
  can't use.
- **Capabilities & events live in `@hackos/shared`.** Never inline capability
  or event string literals.
- **One API entry point.** Call the backend through `lib/api.ts` (`api.get/…`);
  it's always credentialed and surfaces the API's `{ error: { code, message }}`
  envelope as `ApiError`. Show `ApiError.message` verbatim.
- **Auth through the Better Auth client.** All sign-up/in/out, verification and
  password reset go through `lib/auth-client.ts`, then `refresh()` the session.
- **Theme tokens only.** Style with semantic tokens (`bg-background`,
  `text-muted-foreground`, `border`, `text-destructive`, …) defined in
  `app/globals.css`. Never hardcode hex/oklch in a component. Spacing, type
  scale, control sizes, and the `Surface`/`Section`/`Overlay` container
  contract are specified in [`docs/DESIGN.md`](../../docs/DESIGN.md) — the
  consolidated design/UX rulebook; read it before building screens.
- **All copy through `lib/i18n.ts`'s `t()` (i18next), in all three locales.**
  Every user-facing string is a resource entry in
  `packages/shared/locales/{en,es,gl}/{common,web}.json` with `es`, `gl`, and
  `en` — no hardcoded literals in components, no partial entries. Copy must
  never leak story IDs (`H29`) or capability keys (`queue:admin`); `pnpm
  check:copy` (part of `pnpm lint`) enforces both rules.

## Adding a new story module (the pattern)

1. Add the route group/page under `src/app/(app)/<module>/`.
2. Add its nav entry (with the guarding capability) to `lib/nav.ts` and drop
   the `soon` flag.
3. Add DTO types to `lib/types.ts`; call the API via `lib/api.ts`.
4. Compose from `components/ui` + `components/common`; extract anything reused
   twice into `components/common`.
5. Gate controls with `<CapabilityGate>` / `useCan`.
