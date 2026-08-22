# Navigation: capability-based workspaces

The web sidebar and the mobile tab bar are both driven by capability and
association data, never by a display role. IA rules live in
[`DESIGN.md`](./DESIGN.md) §7 (H8: capability groups, never role; H55: one
app, additive tabs).

Web: `apps/web/src/lib/nav.ts` (data) + `apps/web/src/components/layout/app-sidebar.tsx`
(rendering). Mobile: `apps/mobile/lib/tabs.ts` (data) +
`apps/mobile/app/(tabs)/_layout.tsx` (rendering).

## Contents

- [Principle](#principle)
- [Web: personal area + workspaces](#web-personal-area--workspaces)
  - [Stable personal area](#stable-personal-area-personal_nav)
  - [Work workspaces](#work-workspaces-workspaces)
  - [Behaviour](#behaviour)
- [Mobile: overflow selector for operators](#mobile-overflow-selector-for-operators-h55)
- [Decision-only applications](#decision-only-applications)
- [Association-aware domain pages](#association-aware-domain-pages)

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

Visible to any authenticated account, no capability required: Schedule, My
applications, My project, My queue, Wallet, Inbox, My profile — except for a
**pure applicant**: an account with no confirmed spot (`GET /api/me`'s
`hasEventAccess`, `apps/api/src/modules/identity/role.ts#hasEventAccess`), no
operational capability, and no room-judge/sponsor-rep association
(`isPureApplicant` in `apps/web/src/lib/session.tsx`). That account has
nothing to do yet on My project, My queue, Wallet, or Inbox, so those four
hide (`NavItem.hideForPureApplicant` in `nav.ts`) — Schedule, My applications,
and My profile stay, since applying (or checking an application's status) is
exactly what they still need.

There is deliberately no dashboard/home page: `/timetable` (Schedule) is the
landing destination after sign-in and email verification
(`apps/web/src/lib/invite-destination.ts`, `apps/web/src/lib/return-path.ts`),
and every other destination a dashboard would have surfaced (applications,
queue, project, wallet) already has its own stable nav entry above.

My project and My queue also hide independently of `isPureApplicant` for
**any** account — participant, judge, or sponsor rep — that currently has no
project/queue data of its own: `GET /api/me`'s `hasProject`/`hasQueueItems`
booleans (`apps/api/src/modules/projects/service.ts#hasMyProject`,
`apps/api/src/modules/queue/reads.ts#hasMyQueueItems`) back
`NavItem.hideIfNoProject`/`hideIfNoQueueItems` in `nav.ts`. My project stays
visible without a project yet when `canCreateProject` is true (H19
self-creation open to the caller) — otherwise hiding the link would remove
their only entry point to create one. Sponsor reps have no H19 self-creation
path, so for them My project hides exactly when they have no project.

### Work workspaces (`WORKSPACES`)

Eight capability-gated groups. A workspace renders only when at least one of
its items is visible; each visible item still checks its own capability so a
workspace never over-grants access.

| Workspace | Items | Visible when |
| --- | --- | --- |
| Applications | Applications | `applications:review`, `applications:decide`, or `applications:manage` |
| Projects and imports | Projects, Resolve import | `projects:read`, `projects:import`, `judge:panel`, or an assigned-judge/sponsor-rep association |
| Live judging | Queue operations, Judging, Rooms, Reviews, Judging window | `queue:operate`, `queue:admin`, `judge:panel`, an assigned-judge association (Judging), or a sponsor-rep association (Rooms); Judging window is `queue:admin` only |
| Logistics | Accreditation, Meals, Activities, Presence, Logistics stats | `accredit:scan`, `activity:scan`, `presence:scan`, `logistics:stats` (each item its own capability — H22-H27 per-station gating) |
| Programme | Manage schedule, TV control, Announcements | Manage schedule: any account holding at least one capability (H59 `staffVisible` — full CRUD incl. hidden/draft items is further gated by `schedule:manage` inside the page itself, not at the nav level), `tv:control`, `announcements:manage` |
| Sponsors | Enterprises, Challenges, Sponsor FAQ | `sponsors:manage`, `queue:admin`, or a sponsor-rep association (Sponsor FAQ: `sponsors:manage` only, plus sponsor-rep read access enforced server-side) |
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
  sheet, the accordion is bypassed and every item stays directly reachable.
- The sticky top bar carries the **workspace**, never the leaf
  (`components/layout/header-title.tsx`, resolved by `workspaceForPath`): the
  page already renders its own name in the `h1`, so naming the nav item there
  would print the same string twice. Personal-area routes and
  single-destination workspaces render nothing — the sidebar draws no group
  header for the latter either, so their label names the leaf.
- One name per destination: `nav.ts` and the page `h1` reference the same
  message key. `/timetable` is **Schedule** (the read-only programme every
  participant uses) and `/schedule` is **Manage schedule** (the editor); no
  multi-destination workspace is labelled with one of its own items.
- Every href in `nav.ts` is a stable, published URL: existing deep links and
  bookmarks must keep working without a redirect.

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
  scanning must never sit behind an ellipsis. The fifth slot becomes the
  **"Others" overflow selector**, and the less-frequent personal
  destinations (Queue, Wallet, Account) move behind it as pseudo-tabs.
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

## Decision-only applications

`applications:decide` is a first-class Applications workspace capability. A
decision-only account can discover and open the protected application list and
form metadata, then use Outbox and Sent decisions, but it never receives form
builder, review, score, note, or response-edit controls solely from that
capability.

## Association-aware domain pages

Several domain pages gate access on association facts (`isRoomJudge`,
`isSponsorRep`) in addition to capabilities, because a room judge or sponsor
rep can be granted access to a domain without holding the matching
capability directly — the backend already authorizes them through the
association (`room_judges`, sponsor-rep links), so the frontend gate must
check the same fact or it strands them on a client-side "no access" screen
despite a working API.

- `apps/web/src/app/(app)/judging/page.tsx` — `canUse`/`canJudge`
  (`apps/web/src/lib/judging-workspace.ts#workspaceAccess`) fold in
  `isRoomJudge` alongside `judge:panel`/`queue:operate`/`queue:admin`.
- `apps/web/src/app/(app)/projects/page.tsx` — `canView` folds in
  `isRoomJudge` for judges (rather than `judge:panel` alone) and
  `isSponsorRep` for sponsors (rather than `me?.role === "sponsor"`, which
  collapses to `"judge"` for a sponsor rep who also judges — see
  [Principle](#principle)). `GET /api/repos`
  (`resolveRepoScope` in `apps/api/src/modules/projects/routes.ts`) scopes
  correctly for both already; only the frontend gate needs to match.
- `apps/web/src/app/(app)/challenges/page.tsx`,
  `apps/web/src/app/(app)/enterprises/page.tsx`, and
  `apps/web/src/app/(app)/queue/rooms/page.tsx` gate on `isSponsorRep`.
