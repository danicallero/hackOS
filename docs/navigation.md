# Navigation: capability-based workspaces

Implements issue [#187](https://github.com/danicallero/hackOS/issues/187)
(IA rules now consolidated in [`DESIGN.md`](./DESIGN.md) §7). Stories: H8
(capability groups, never role), H55
(one app, additive tabs), and every domain story a workspace links to.

Web: `apps/web/src/lib/nav.ts` (data) + `apps/web/src/components/layout/app-sidebar.tsx`
(rendering). Mobile: `apps/mobile/lib/tabs.ts` (data) +
`apps/mobile/app/(tabs)/_layout.tsx` (rendering).

## Principle

Every navigation decision is a function of **effective capabilities and
association facts** (is this account a room judge? a linked sponsor rep?),
never of the illustrative `role` string (`apps/api/src/modules/identity/role.ts`
computes a single-priority `role` for *display* only — admin > judge > sponsor
> staff > participant — and explicitly says it must never gate a permission
check). A multi-capability account keeps every relevant destination
simultaneously; nothing is hidden to make room for something else, and there
is no role switcher.

`GET /api/me` also returns `isRoomJudge` and `isSponsorRep` booleans
(`apps/api/src/modules/identity/role.ts#computeMembershipFlags`) precisely so
navigation can check both facts independently — the single `role` field
collapses a sponsor rep who also judges to `"judge"`, which would hide their
sponsor workspace if nav gated on `role` instead.

## Web: personal area + workspaces

### Stable personal area (`PERSONAL_NAV`)

Always visible to any authenticated account, no capability required: Home
(dashboard), Schedule, My applications, My project, My queue, Wallet, Inbox,
My profile.

### Work workspaces (`WORKSPACES`)

Eight capability-gated groups replace the old flat "operations" +
"administration" sections. A workspace renders only when at least one of its
items is visible; each visible item still checks its own capability so a
workspace never over-grants access.

| Workspace | Items | Visible when |
| --- | --- | --- |
| Applications | Applications | `applications:review`, `applications:decide`, or `applications:manage` |
| Projects and imports | Projects, Resolve import | `projects:read`, `projects:import`, `judge:panel`, or an assigned-judge/sponsor-rep association |
| Live judging | Queue operations, Judging, Rooms, Reviews, Judging window | `queue:operate`, `queue:admin`, `judge:panel`, an assigned-judge association (Judging), or a sponsor-rep association (Rooms); Judging window is `queue:admin` only |
| Logistics | Accreditation, Meals, Activities, Presence, Logistics stats | `accredit:scan`, `activity:scan`, `presence:scan`, `logistics:stats` (each item its own capability — H22-H27 per-station gating) |
| Programme | Manage schedule, TV control, Announcements | `schedule:manage` (also judge-visible), `tv:control`, `announcements:manage` |
| Sponsors | Enterprises, Challenges | `sponsors:manage`, `queue:admin`, or a sponsor-rep association |
| Event setup (`Configuración` in es/gl) | Event settings, Libraries | Event settings: any of `event:manage`, `venue:manage`, `wallet:manage`, `presence:manage`, `invites:manage` (each tab within it individually gated by its own capability — H8); Libraries: `intolerances:manage` |
| Access and audit | Users, Permissions, Audit log | `users:read`, `permissions:manage`, `audit:read` |

The admin wildcard (`*`) passes every capability check and therefore sees
every workspace and every item (`apps/web/src/lib/session.tsx`).

### Behaviour

- Each workspace is a collapsible group. Expanding one persists it as the
  "last workspace" for that device (`localStorage`, key
  `hackos-last-workspace`, via `readLastWorkspace`/`writeLastWorkspace` in
  `lib/nav.ts`); on the next visit, the workspace containing the active route
  wins, and otherwise the persisted last workspace re-opens.
  Collapsed to the icon rail (`Sidebar collapsible="icon"`) or on the mobile
  sheet, the accordion is bypassed and every item stays directly reachable —
  matching the pre-#187 icon-rail behaviour exactly.
- The sticky top bar carries the **workspace**, never the leaf
  (`components/layout/header-title.tsx`, resolved by `workspaceForPath`): the
  page already renders its own name in the `h1`, so naming the nav item there
  printed the same string twice (issue #297). Personal-area routes and
  single-destination workspaces render nothing — the sidebar draws no group
  header for the latter either, so their label names the leaf.
- One name per destination: `nav.ts` and the page `h1` reference the same
  message key. `/timetable` is **Schedule** (the read-only programme every
  participant uses) and `/schedule` is **Manage schedule** (the editor); no
  multi-destination workspace is labelled with one of its own items.
- No routes moved: every href in `nav.ts` matches the previously published
  URL, so existing deep links and bookmarks keep working without a redirect.

## Mobile: overflow selector for operators (H55)

`apps/mobile/lib/tabs.ts` computes `primaryTabs()`/`overflowTabs()` from
effective capabilities. The bar is a real platform tab bar
(`expo-router/unstable-native-tabs` in `app/(tabs)/_layout.tsx`), and a
native `UITabBarController` silently collapses anything past its fifth item
into iOS's own "More" screen — which bypasses the app's custom overflow menu
entirely — so the bar is capped at five items, and which triggers show is
toggled per experience with `hidden` (hidden screens stay routable):

- **Non-operator account**: schedule, queue, wallet, notifications +
  **Account** directly in the fifth slot. No overflow menu at all.
- **Operator** (any of `accredit:scan`, `presence:scan`, `activity:scan`, or
  the admin wildcard): the daily shift tools take the bar — schedule,
  **Scanner**, Activities (`activity:scan` holders only), notifications —
  honouring the #187 finding that scanning must never sit behind an
  ellipsis. The fifth slot becomes the **"Others" overflow selector**, and
  the less-frequent personal destinations (Queue, Wallet, Account) move
  behind it as pseudo-tabs.
- **Queue-only operator** (`queue:operate`, `queue:admin`, or `*`, without a
  scanner capability): Queue operations is a direct tab alongside Schedule and
  Alerts; Queue, Wallet, and Account move to Others. If the person also has a
  scanner capability, Queue operations joins Others so Scanner stays directly
  reachable.

The "Others" slot is a tab trigger that opens a **native dropdown selector**,
not a screen. It's declared with `role="search"`, which on iOS 18+ renders it
as the separated (Liquid Glass) capsule visually split from the tab group,
with an ellipsis icon and hidden label. The trigger itself never navigates:
an invisible native `MenuView` (`@expo/ui/community/menu`) is positioned over
the capsule and pops the dropdown listing Queue, Wallet, Account, and (for a
scanner operator with queue access) Queue operations with
icons and localized labels. On Android, a plain `Pressable` overlay opens the
same menu via its imperative `show()`, because the Compose interop tree
intermittently drops the very first touch.

Selection simulates tab navigation
(`apps/mobile/lib/operations-navigation.ts`
`resolveOperationsNavigationAction`): picking the section already on screen
is a no-op, and picking another always `router.replace()`s — a tab switch,
never a stack push — so overflow screens don't stack duplicates and back
behaviour stays sane; deeper screens inside a section still push normally on
top of it. Pathname matching normalizes Expo Router route groups first
(`/others/...` vs `/(tabs)/others/...`).

`OVERFLOW_TAB_KEYS` and the exhaustive descriptor maps in
`apps/mobile/lib/overflow-tabs.ts` are the single source of truth for these
destinations. `operations-navigation.ts` derives both its route type and its
pathname classification from that source; it must never introduce a parallel
union or a default destination. Adding an overflow page therefore requires a
key plus its icon, route, and localized-label descriptors (enforced by
TypeScript `Record`s). `operations-navigation.test.ts` iterates every declared
key and verifies grouped/ungrouped pathname recognition, same-section no-op,
all cross-section replacements, and entry from outside the overflow stack.
This guards every new destination without requiring someone to remember an
extra hand-written navigation case. Keep this registry free of React Native
runtime imports so its contract tests remain deterministic outside Expo.

On iPad/macOS, pages opened from the real Others hub remain in the hub's
single native Stack. The `operations` and `team` child layouts therefore use a
plain `Slot` on that idiom instead of introducing another navigator: a nested
Stack produces a second navigation-bar row and stops iOS from integrating
back, status, search, and filter controls alongside the top tab chrome. On
iPhone those layouts retain their own Stack because overflow destinations are
header-less pseudo-tabs and still need local navigation chrome.

## Decision-only applications and dashboard shortcuts

`applications:decide` is a first-class Applications workspace capability. A
decision-only account can discover and open the protected application list and
form metadata, then use Outbox and Sent decisions, but it never receives form
builder, review, score, note, or response-edit controls solely from that
capability.

The dashboard follows the same additive policy as the sidebar. Its quick
actions are derived independently from effective capabilities,
`isRoomJudge`, and `isSponsorRep`; a sponsor representative assigned as a
room judge sees both sponsor and judging actions. The derived `role` remains
display-only and is not consulted for dashboard access.

This work reuses existing localized action labels, so it requires no new
translation keys.

## Association-aware domain pages

`apps/web/src/app/(app)/judging/page.tsx` was fixed to `isRoomJudge` by
issue #225 (H40): the page previously gated `canUse`/`canJudge` purely on
`judge:panel`/`queue:operate`/`queue:admin` capabilities
(`apps/web/src/lib/judging-workspace.ts#workspaceAccess`), so a room judge
added by a sponsor rep with zero capability grants could see the nav link
(`judgeVisible: true`) but landed on a client-side "no access" empty state —
even though the backend already allowed them in via the `room_judges`
fallback. `workspaceAccess` now takes `isRoomJudge` and folds it into
`canJudge`/`canUse` alongside the capability checks.

`apps/web/src/app/(app)/projects/page.tsx` was fixed the same way: `canView`
gated judges on `judge:panel` (missing the `room_judges` association
fallback, H40) and gated sponsors on `me?.role === "sponsor"` — which
collapses to `"judge"` for a sponsor rep who also judges, per the single-
priority `role` problem this doc calls out above — instead of `isSponsorRep`
(H46). `GET /api/repos` (`resolveRepoScope` in
`apps/api/src/modules/projects/routes.ts`) already scoped correctly for
both; only the frontend gate was stale.

`apps/web/src/app/(app)/challenges/page.tsx`, `apps/web/src/app/(app)/enterprises/page.tsx`,
and `apps/web/src/app/(app)/queue/rooms/page.tsx` were fixed to `isSponsorRep`
by #192 (Sponsor workspace).
