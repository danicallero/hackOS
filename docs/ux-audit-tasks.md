# Web UX simplification audit and task plan

Status: implementation complete; final repository and browser QA recorded below
Scope: apps/web authenticated application  
Reference pattern: the live judging workspace

## Outcome

The web app does not need less capability. It needs fewer simultaneous
decisions.

The guiding rule for this work is:

> Split unrelated jobs, not complex steps within one job.

The judging screen is the current benchmark. It is complex, but the
complexity is coherent: a judge is doing one job, the queue and presentation
context are adjacent, scoring is the primary flow, and rare actions are
progressively disclosed. It should remain intact and should influence the
rest of the product.

This audit uses the upstream ui-ux-pro-max skill, the repository design
rules in DESIGN.md, the capability/workspace model in navigation.md, and a
source-level review of every web route. The product must remain
capability-based and additive: simplification must not hide access or replace
capabilities with role assumptions.

## Implementation record

The audit has been implemented incrementally in these slices:

- `3be1797` — exclusive workspace disclosure, dashboard attention/next-action
  hierarchy, and the shared URL-backed tab hook (`H8`, `H55`).
- `2347e39` — overview-first application, user, enterprise, and permission
  records with capability-filtered tabs and preserved legacy user tab aliases
  (`H8`, `H11`, `H44`).
- `2c02411` — route-backed challenge drafting, dedicated announcement create /
  edit routes, and separate presence scan, sessions, and hours workflows
  (`H24`, `H44`, `H50`).
- `00107b5` — explicit attendee timetable versus organizer schedule-management
  language (`H47`).

Decisions made during implementation:

- `?tab=` is the canonical deep-link format. Invalid values fall back to the
  first authorized tab, and legacy user links for `qr`, `permissions`, and
  `presence` resolve to `access` or `attendance`.
- Challenge creation now creates the backend’s hidden draft on a dedicated
  stepper. Publication remains a separate detail-tab action, preserving the
  draft-versus-published state boundary.
- Announcement drafting and publication settings share one dedicated form
  route, while the list remains a status/search/delete surface. Delivery state
  remains visible in the list but is not mixed into the writing flow.
- Presence read models remain live and independently retryable; only their
  navigation and visible task scope changed. Queue generation, room operation,
  reviews, and the active judging workflow remain separate and unchanged.

Running verification:

- `pnpm lint` passes, including copy and page-size checks. Biome reports one
  existing non-failing warning in `e2e/mobile/detox.config.cjs`.
- `pnpm --filter @hackos/web typecheck` passes.
- `pnpm --filter @hackos/web test` passes: 30 files, 190 tests.
- `E2E_WEB_URL=http://localhost:3001 pnpm test:ui:browser` passes: 8 browser
  smoke tests across Chromium, Firefox, WebKit, and mobile Chromium.
- Authenticated screenshots could not be captured in this environment: the
  browser connector had no available browser, and the embedded Orca runtime
  stopped immediately after launch. The browser suite therefore verified the
  unauthenticated running app, but no screenshot is claimed for an
  authenticated changed state.

## Experience goals

### Participant and sponsor-facing surfaces

- One obvious next action.
- Plain-language labels and minimal configuration choices.
- Summaries before details.
- No organizer-only controls in the primary reading path.
- Tabs only for small, closely related peer views.

### Organizer and administrator surfaces

- More complexity is acceptable when it belongs to one operational task.
- Independent workflows must have independent routes or clearly scoped tabs.
- Save state, permissions, and destructive actions must be local to the thing
  being edited.
- Filters, exports, history, and diagnostics should be secondary to the main
  operational action.

### Live operations surfaces

- Optimize for speed, state visibility, and recovery from mistakes.
- Keep related real-time context together, as in judging.
- Do not split a single time-sensitive workflow merely to reduce visual
  density.

## Decision rules

Use a route or child page when a section has an independent save cycle,
permission model, data load, URL/deep-link need, or business state.

Use a tab when views belong to the same object, are peers, are switched between
frequently, and share the same context. Tabs must be URL-backed so refresh,
back/forward, bookmarks, and links preserve the view.

Use a card when the content is a summary or a shortcut. Use a modal only for a
short create, confirm, or focused edit flow. A long form with multiple
business areas is a page or a stepper, not a modal.

## Findings and priorities

### P0 — reduce simultaneous choices in the shell

Problem: The sidebar renders eight personal destinations and up to eight
capability workspaces. Each workspace group can remain open independently, so
an administrator can expose roughly thirty destinations at once.

Evidence: apps/web/src/components/layout/app-sidebar.tsx and
apps/web/src/lib/nav.ts.

Task UX-01 — make workspace disclosure exclusive

- Keep the personal area always available.
- Allow only one capability workspace group to be expanded at a time.
- Keep the active workspace expanded after navigation.
- Restore the last workspace only when it is useful; do not restore every
  expanded group.
- Preserve access to every item and the collapsed icon rail.
- Add a visible active state for both the workspace and current page.

Acceptance criteria: An organizer can see where they are and reach every
authorized destination without scanning multiple expanded groups. No
capability is removed or role-gated.

### P0 — make the dashboard a starting point, not a second navigation system

Problem: The dashboard combines event phase, next schedule item,
announcements, application status, queue status, and capability-dependent
quick actions. For staff, it repeats much of the sidebar and mixes personal
and operational work.

Evidence: apps/web/src/app/(app)/dashboard/page.tsx.

Task UX-02 — redesign dashboard around attention and next action

- Lead with the current event state and one recommended next action.
- Keep Today or Needs attention as the primary content block.
- Keep personal application/queue status for participants, but do not make it
  compete with organizer operations.
- Replace the current multi-item quick-action grid with one prioritized action
  and a compact More workspaces link, or a capability-specific start page.
- Do not add a role switcher; capabilities remain the authorization truth.
- Preserve announcements as a compact feed with a route to the full inbox.

Acceptance criteria: A first-time participant can identify what to do next
within five seconds. An organizer can start their most likely operational task
without choosing among a second set of navigation tiles.

### P0 — establish route-backed tab behavior

Problem: Most tab groups use local defaultValue state. Refresh, back/forward,
and deep links lose the active view. Event settings already demonstrates the
desired query-backed behavior.

Task UX-03 — create one canonical URL-backed tab pattern

- Support a stable ?tab= migration path first.
- Preserve unknown/invalid tab values by falling back safely.
- Update the URL when the user changes tabs without a full reload.
- Preserve unsaved-change guards where they already exist.
- Add a reusable test for refresh, back/forward, direct links, and invalid tabs.
- Migrate users, inbox, wallet, libraries, challenges, applications, and
  logistics statistics.

Acceptance criteria: Every tab that remains a tab can be shared and reopened
in the same state. A tab is not the only way to access a critical workflow;
routes remain understandable and capability checks remain unchanged.

### P1 — split the high-density record and editor surfaces

#### UX-04 — application management

apps/web/src/app/(app)/applications/[id]/page.tsx currently combines form
building, review, decision outbox, and sent decisions. These are separate
workflows with separate data and permissions.

Target information architecture:

- Overview: application identity, state summary, and key counts.
- Builder: metadata and questions.
- Review: responses and internal decision.
- Decisions: internal outbox and communicated decisions, visibly distinct.

Prefer child routes such as builder, review, and decisions. A query-backed tab
migration is acceptable as an interim step. Use the shared PageHeader. Do not
merge accepted internally with sent to participant; the domain requires that
distinction.

#### UX-05 — user administration

apps/web/src/app/(app)/users/[id]/page.tsx has seven top-level tabs: overview,
QR codes, permissions, presence, logs, application, and projects.

Target information architecture:

- Overview: identity, current status, and important actions.
- Access: permissions and QR/badge actions.
- Attendance: presence and physical activity.
- Activity: logs and audit history.
- Applications.
- Projects.

QR generation should be an action or compact overview card rather than a
full-time top-level destination. Preserve compatibility for existing
?tab=presence links while migrating.

#### UX-06 — enterprise administration

apps/web/src/app/(app)/enterprises/[id]/page.tsx places completeness,
branding, editing, challenges, members, and invite links in one long record
page.

Target information architecture:

- Overview: completeness and important summary.
- Profile and branding.
- Challenges.
- Members.
- Invitations.

Keep the overview short. Each management area should have a local save scope
and a local primary action. Sponsor-facing enterprise views should default to
the summary, not the management surface.

#### UX-07 — permission group management

apps/web/src/app/(app)/permissions/[groupId]/page.tsx combines group details,
capabilities, template reset, members, included groups, and destructive
actions in one long page.

Target information architecture:

- Overview/details.
- Capabilities.
- Members.
- Included groups.
- Advanced/reset actions behind an explicit secondary area.

The capabilities screen must explain the effect of changes before saving. Keep
dangerous actions away from routine member and capability editing.

#### UX-08 — challenge authoring

apps/web/src/app/(app)/challenges/[id]/challenge-cards.tsx has six tabs—
content, prizes, judging, winners, publish, and history—inside a shared form
with a distant save action. The challenge creation flow is also a large
modal.

Target information architecture:

- Content.
- Prizes.
- Judging.
- Publication.
- Results/winners.
- History.

Use child routes or URL-backed tabs with local save status. Make winners and
history read-only/result areas rather than part of the editing form. Move
creation to /challenges/new or a stepper: Basics → Prizes → Judging → Publish.
A draft should be saveable before the final publish step.

#### UX-09 — announcements

apps/web/src/app/(app)/announcements/page.tsx contains list management and a
large create/edit workflow involving multilingual copy, audience, scheduling,
expiry, and delivery state.

Keep the list focused on status and the next action. Move create/edit to
dedicated routes or a stepper with a preview. Separate drafting from
publishing; do not make the user reason about delivery state while writing
copy.

### P1 — separate operational contexts without breaking live workflows

#### UX-10 — logistics presence

apps/web/src/app/(app)/logistics/presence/page.tsx and its PresencePanel
combine badge scanning, manual entry/exit, attendance hours, and open
sessions.

Target information architecture:

- Scan: one fast entry/exit workflow.
- Sessions: open sessions and attendance controls.
- Hours/reporting: attendance hours and review.

The scan surface should not require operators to scan past two full reporting
tables. Keep a compact recent-scan result visible for recovery and confidence.

#### UX-11 — logistics statistics

apps/web/src/app/(app)/logistics/stats/page.tsx has before/during/after event
phases, each of which is effectively a separate dashboard. The current phase
is stored in local storage, which is not shareable or reliable for
collaborators.

Use route-backed phases: before, during, and after. Within each phase, keep
the primary operational view first and move exports, rankings, and
privacy/reporting to a secondary route or disclosure area. Preserve direct
links and capability checks.

#### UX-12 — queue and room operations review

Review apps/web/src/app/(app)/queue/page.tsx, queue/rooms, and queue/reviews
against the judging benchmark. Keep these surfaces task-focused: queue
generation, room assignment, and review should not become one mega-dashboard.
If a page mixes those jobs, split them by route; do not split the active room
workflow while it is in use.

### P2 — consistency and comprehension improvements

#### UX-13 — standardize record headers

Several record pages hand-roll their h1 and action layout while projects and
users already use the shared PageHeader. Standardize applications, challenges,
enterprises, and any migrated record child route on the canonical header. The
header should show one page name, one primary action, and only the secondary
actions needed in that context.

#### UX-14 — clarify schedule surfaces

Keep schedule/page.tsx as the organizer schedule-management surface and
timetable/page.tsx as the attendee-facing timetable. Make the distinction
explicit in labels, descriptions, and navigation so users do not have to
infer which one is authoritative for them.

#### UX-15 — simplify visual hierarchy

- Prefer sentence-case labels and meaningful headings over decorative
  uppercase labels.
- Keep one accent/primary action per scope.
- Use summary stats only when they help the immediate task; move secondary
  breakdowns behind Details.
- Preserve the existing design tokens, contrast, state colors, and semantic
  distinctions from DESIGN.md.
- Ensure all clickable controls have clear hover, focus, and pointer
  affordances.

## Full screen inventory

This is the disposition for every current web area. Keep means retain the
information architecture and apply only consistency/accessibility checks; it
does not mean skip QA.

| Area | Screens | Disposition |
| --- | --- | --- |
| Personal home | Dashboard | Redesign around attention and one next action — UX-02 |
| Personal applications | My applications list, application detail | Keep list focused; add progress and simplify detail navigation |
| Personal project | My project | Keep; verify empty/loading/error states |
| Personal queue | My queue | Keep as a single live task; use judging’s state clarity |
| Personal schedule | Timetable | Keep; clarify attendee language and current event state |
| Personal wallet | Wallet | Keep tabs if URL-backed; one primary wallet action |
| Personal messages | Inbox | Keep tabs if URL-backed; prioritize unread/next action |
| Personal profile | Profile, secondary email verification | Keep; make verification state and next action explicit |
| Applications | List, application builder, review, decisions | Split detail workflows — UX-04 |
| Projects | List, project detail | Mostly keep; preserve overview-first layout |
| Project intake | Import, unmatched records | Keep as a guided import/reconciliation flow; do not merge into projects list |
| Live judging | Judging, presentation, scoring | **Keep as the reference pattern**; do not split the active judging task |
| Queue operations | Queue, room queues, reviews, review detail | Keep separate by job; review against UX-12 |
| Logistics | Accreditation | Keep task-focused; reduce nonessential stat cards if needed |
| Logistics | Presence | Split scanning, sessions, and reporting — UX-10 |
| Logistics | Meals, activities | Keep as focused station/task pages |
| Logistics | Statistics | Route-backed event phases — UX-11 |
| Programme | Schedule management, timetable | Keep separate; clarify organizer vs attendee intent — UX-14 |
| TV operations | TV control, live settings, timetable | Keep specialized; make live mode/state obvious |
| Challenges | List, create, challenge detail | Move create out of modal; split editor/result/history areas — UX-08 |
| Enterprises/sponsors | Enterprise list, enterprise detail | Keep list; split detail management areas — UX-06 |
| Users/access | User list, user detail | Keep list; group user detail by access, attendance, activity, and records — UX-05 |
| Permissions | Permission groups, group detail | Keep list; split group detail save scopes — UX-07 |
| Announcements | Announcement list, create/edit | Separate drafting, preview, and publishing — UX-09 |
| Audit | Audit log | Keep; prioritize filter/search and readable event detail |
| Event setup | Event settings | Keep as the reference for URL-backed tabs and unsaved-change protection |
| Libraries | Intolerances, universities | Keep small peer tabs; make tabs URL-backed |

## Recommended implementation sequence

1. **Navigation and dashboard:** UX-01 and UX-02. This reduces the first
   impression of complexity across every capability.
2. **Tab infrastructure:** UX-03. This makes the later information-architecture
   changes reversible and preserves deep links.
3. **Highest-risk admin records:** UX-04, UX-05, UX-06, and UX-07. These are
   the most obvious examples of unrelated workflows sharing one screen.
4. **Challenge and announcement authoring:** UX-08 and UX-09. Replace long
   modals with draftable, understandable workflows.
5. **Logistics contexts:** UX-10, UX-11, and UX-12. Keep live operations fast
   while separating scanning, planning, and reporting.
6. **Consistency pass:** UX-13, UX-14, and UX-15, followed by responsive and
   accessibility QA across all changed routes.

## Cross-screen acceptance criteria

- A participant, sponsor, and organizer can each identify their next action
  without understanding the full permission model.
- Every screen has one visually primary action for its current scope.
- No route exposes unrelated workflows merely because they belong to the same
  database record.
- Every retained tab is deep-linkable and survives refresh/back/forward.
- Long forms show local save state, local errors, and local completion status.
- Critical state distinctions remain explicit: internal vs communicated
  decisions, draft vs published, present vs absent, and queue vs presenting.
- Capability access remains additive; the redesign never hides a workspace to
  make the interface look simpler.
- Changed routes are verified at 375px, 768px, 1024px, and 1440px, with
  keyboard navigation, focus visibility, contrast, loading, empty, error, and
  unsaved-change states checked.
- UI changes include screenshots following docs/ui-testing.md before they are
  considered complete.

## Success measures

Before implementation, capture a small baseline with organizers,
participants, and sponsors:

- time to identify the next action from dashboard;
- time to find a user’s permissions and attendance;
- time to edit and publish a challenge;
- time to scan a person in logistics;
- wrong-page or backtracking events;
- confidence rating after completing each task.

The target is fewer navigation decisions and less backtracking, not fewer
features. The judging workflow should remain fast and reliable while the
surrounding management surfaces become easier to understand.
