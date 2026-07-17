# Navigation: capability-based workspaces

Implements issue [#187](https://github.com/danicallero/hackOS/issues/187)
(`docs/ux-ui-audit.md` §3). Stories: H8 (capability groups, never role), H55
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

Nine capability-gated groups replace the old flat "operations" +
"administration" sections. A workspace renders only when at least one of its
items is visible; each visible item still checks its own capability so a
workspace never over-grants access.

| Workspace | Items | Visible when |
| --- | --- | --- |
| Applications | Applications | `applications:review` or `applications:manage` |
| Projects | Projects | `projects:read`, `projects:import`, `judge:panel`, or an assigned-judge/sponsor-rep association |
| Live judging | Queue operations, Judging, Rooms | `queue:operate`, `queue:admin`, `judge:panel`, an assigned-judge association (Judging), or a sponsor-rep association (Rooms) |
| Logistics | Accreditation, Meals, Activities, Presence, Logistics stats | `accredit:scan`, `activity:scan`, `presence:scan`, `logistics:stats` (each item its own capability — H22-H27 per-station gating) |
| Programme | Manage schedule, TV control | `schedule:manage` (also judge-visible), `tv:control` |
| Sponsors | Enterprises, Challenges | `sponsors:manage`, `queue:admin`, or a sponsor-rep association |
| Communications | Announcements | `announcements:manage` |
| Event setup | Event settings, Libraries | `schedule:manage`, `intolerances:manage` |
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
- No routes moved: every href in `nav.ts` matches the previously published
  URL, so existing deep links and bookmarks keep working without a redirect.

## Mobile: one obvious scan entry (H55)

`apps/mobile/lib/tabs.ts` computes `primaryTabs()`/`overflowTabs()` from
effective capabilities. Any of the three scan capabilities (`accredit:scan`,
`presence:scan`, `activity:scan`) or the admin wildcard promotes **Scan**
into the primary tab bar (`apps/mobile/app/(tabs)/scan.tsx`, a thin wrapper
around the existing `GeneralScannerScreen`) — never behind the "Others"
ellipsis. Account moves into the overflow selector only in that case, since
the bar only fits five primary destinations; a non-operator account keeps
Account in the primary bar and has no overflow menu at all.

## Known gap (backend follow-up needed)

Several domain pages still gate *content* on the single-priority `role`
instead of the new `isRoomJudge`/`isSponsorRep` facts (e.g.
`apps/web/src/app/(app)/projects/page.tsx`,
`apps/web/src/app/(app)/dashboard/page.tsx`). This means a sponsor+judge
account can now reach every relevant workspace from the sidebar, but a couple
of the pages behind those links may still only render sponsor- or judge-
specific content for whichever `role` value won priority. Fixing that is
domain page content, out of this issue's Agent boundary (owned by #190
Queue/judging); `isRoomJudge`/`isSponsorRep` are now available on `Me` for
that issue to adopt.

`apps/web/src/app/(app)/judging/page.tsx` was fixed to `isRoomJudge` by
issue #225 (H40): the page previously gated `canUse`/`canJudge` purely on
`judge:panel`/`queue:operate`/`queue:admin` capabilities
(`apps/web/src/lib/judging-workspace.ts#workspaceAccess`), so a room judge
added by a sponsor rep with zero capability grants could see the nav link
(`judgeVisible: true`) but landed on a client-side "no access" empty state —
even though the backend already allowed them in via the `room_judges`
fallback. `workspaceAccess` now takes `isRoomJudge` and folds it into
`canJudge`/`canUse` alongside the capability checks.

`apps/web/src/app/(app)/challenges/page.tsx`, `apps/web/src/app/(app)/enterprises/page.tsx`,
and `apps/web/src/app/(app)/queue/rooms/page.tsx` were fixed to `isSponsorRep`
by #192 (Sponsor workspace).
