# hackOS UX/UI audit

Status: actionable product and design-system audit  
Source of truth: `plan/historias-hackos.md` (H1-H55)  
Surfaces reviewed: Next.js web application, public/authenticated web flows, Expo mobile information architecture, shared product copy, and story-level workflow requirements.

## 1. Executive summary

hackOS already has a credible technical UI foundation: semantic colour variables, Radix interaction primitives, reusable form controls, cards, dialogs, tables, status badges, capability-aware navigation, and localized copy. The experience is not failing because it lacks components. It is failing because the product domains have outgrown a generic dashboard grammar.

The platform serves visitors, applicants, participants, mentors, invited staff, reviewers, admissions decision-makers, logistics operators, judges, queue operators, sponsors, content managers, auditors, privacy administrators, and people who hold several of those responsibilities at once. The current interface frequently presents these distinct jobs as similarly weighted pages in one sidebar and similarly structured cards containing a title, description, and controls.

The target is a light and dark designed event operating system with two density modes built from one design system:

- Participant and public experiences are calm, approachable, and task-led.
- Staff and live-event experiences are compact, state-led, and resilient under time pressure.
- Access is additive and capability-based. Roles are illustrative only and must never become exclusive workspaces or a role switcher.
- Layout, state, and affordance explain the workflow. Supporting text is reserved for risk, privacy, irreversible consequences, or genuinely unfamiliar domain rules.
- Web and mobile share terminology and state models even when their interaction patterns are platform-native.

### Principal findings

1. Information architecture is capability-aware but not task-oriented. A highly privileged account receives a long list of destinations rather than a small number of coherent workspaces.
2. The component API encourages explanatory subtitles. Across the web surface there are 166 `description` props, and page, card, modal, and empty-state descriptions frequently repeat their titles or enumerate visible content.
3. Complex workflows expose the data model too early. Application builders show internal keys, locale codes, option values, and restrictions together; event settings rely on long vertical forms; project and sponsor administration expose implementation terms.
4. Several business-critical distinctions need stronger visual treatment: internal versus communicated admissions decisions; called versus in-room versus presenting; locally saved versus server-confirmed scans; ticket versus badge; optional versus mandatory notifications.
5. Accessibility gaps exist above the primitive layer. Clickable table rows are mouse-only, search fields can rely on placeholders instead of labels, and critical errors are sometimes conveyed only by transient toasts.
6. Visual identity varies by surface. Public cards, operational cards, authentication glows, TV cards, and the cookie notice use different radii, elevations, and colours.
7. Microcopy is usually plain, but it is too abundant and occasionally leaks capability identifiers, story numbers, database concepts, or spatial instructions such as “below”.
8. The cookie notice is intentionally playful. Its political joke is part of the product voice and should remain; the component still needs semantic tokens and localization.

## 2. Product model and user contexts

The following are experience contexts, not mutually exclusive roles. A single account can accumulate several contexts through capabilities.

| Context | Stories | Primary job |
| --- | --- | --- |
| Visitor | H1, H49 | Understand the event and start an application |
| Unverified account | H2-H3 | Verify the email and resume the interrupted task |
| Applicant | H6-H7, H11-H12 | Save a draft, submit, and follow status |
| Accepted applicant | H14-H15 | Understand the deadline and confirm or decline |
| Participant or mentor | H20, H28, H38, H47, H51 | Follow the event, project, queue, passes, and messages |
| Invited staff or sponsor | H9-H10 | Complete contextual onboarding without admin data entry |
| Late invited participant | H10 | Complete logistics details and an application after public closure |
| Reviewer | H13 | Score and annotate submitted applications independently |
| Admissions decision-maker | H14-H15 | Make internal decisions, communicate later, and handle exceptions |
| Access administrator | H8 | Compose capability groups and assign people safely |
| Project import operator | H16-H17 | Preview imports and reconcile unmatched people or prizes |
| Project/queue editor | H18-H21 | Correct projects, teams, and challenges, including during judging |
| Accreditation operator | H22-H23 | Assign or rotate badges under unreliable connectivity |
| Presence operator | H24 | Record and reconcile physical presence |
| Meal/activity scanner | H25-H26 | Process a fast queue, repeats, and offline scans |
| Logistics analyst | H27 | Forecast orders and monitor attendance and consumption |
| Queue operator | H29-H35, H37, H39-H40 | Keep rooms moving and resolve exceptional states |
| Judge | H31-H37 | Admit, time, collaboratively score, and submit evaluations |
| TV controller | H41-H42 | Preview and broadcast venue-wide display modes |
| Sponsor representative | H43-H46 | Manage company, challenge, judges, rooms, and results |
| Programme/content manager | H45, H47-H50 | Schedule content across public web, mobile, and TV |
| Auditor/privacy administrator | H53-H54 | Investigate actions and export, delete, or anonymize data |
| Multi-capability user | H55 | Accumulate relevant tools without changing identity |

## 3. Target information architecture

### 3.1 Stable personal area

Always available to authenticated accounts when relevant:

- Home
- Schedule
- My applications
- My project
- My queue
- Wallet
- Inbox
- Profile

Unavailable concepts should not become permanent empty navigation items. For example, “My project” can appear after project creation is enabled, a project is linked, or the event reaches the relevant phase.

### 3.2 Additive work area

Destinations appear by effective capability, never by illustrative role:

- Applications
- Projects
- Live judging
- Logistics
- Programme
- Sponsors
- Communications
- Event setup
- Access and audit

Each destination is a workspace with local navigation, not a flat collection of globally weighted pages. A participant who also judges retains their personal queue and gains Live judging. A sponsor judge gains the sponsor workspace and assigned judging tools without switching roles.

### 3.3 Navigation behaviour

- Keep the last workspace and local tab per device.
- Order time-critical work above configuration during the event.
- Allow pinning or recent destinations for users with many capabilities.
- Use counts and state, not “Soon” badges, to communicate actionable attention.
- On mobile, promote scanning to a first-class operational entry point whenever a scan capability exists; do not bury the primary shift task under a generic ellipsis.

## 4. Design-system specification

### 4.1 Foundation tokens

| Token group | Specification |
| --- | --- |
| Spacing | 4, 8, 12, 16, 24, 32, 48 px |
| Page title | 24/32, semibold, balanced |
| Section title | 18/24, semibold |
| Body | 14/20, regular |
| Label | 13/18, medium |
| Meta | 12/16, muted; no artificial tracking |
| Data | Tabular numerals; monospaced only for identifiers or timers |
| Controls | 36 px default, 32 px compact, 40 px prominent/mobile-friendly |
| Radius | 6 px controls, 8 px surfaces and overlays, full only for pills/avatars |
| Elevation | Border-only inline surface; small shadow for floating menus; large shadow for modal overlays |
| Layout rhythm | 24 px between major sections, 16 px within sections, 8 px between tightly related controls |
| Accent | One interactive accent per view; status colours only for actual state |

### 4.2 Surface hierarchy

Replace the overloaded generic card concept with three explicit levels:

1. `Surface`: border-only grouping inside a page; compact padding; no shadow.
2. `Section`: titled domain section with optional state/action; 16-20 px padding.
3. `Overlay`: dialog, popover, or menu; elevated and focus-managed.

Public marketing cards may use more whitespace, but should keep the same radius and colour tokens.

### 4.3 Page header

Default anatomy:

- Optional breadcrumb or workspace context
- Page title
- State/count next to the title when useful
- One primary action and optional secondary menu

Descriptions are exceptional. They should not restate the title or list the content visible immediately below.

### 4.4 Buttons and actions

- One primary action per scope.
- Secondary actions use outline or ghost styling.
- Low-frequency and exceptional actions live in an overflow menu.
- Destructive styling appears only on the destructive action and its confirmation.
- Icon-only actions require an accessible name and visible focus.
- Disabled transactional actions must reveal the blocking condition locally.

### 4.5 Tables and lists

- Navigation rows must use links or full keyboard semantics, not mouse-only row click handlers.
- Search requires a persistent or visually hidden label, a clear action, and a result count.
- Differentiate an empty dataset from zero filter results.
- Bulk actions appear only after selection and state what set they affect.
- Pagination and selection text must be localized.
- Dense mobile layouts become cards or drill-down lists rather than horizontally scrolling tables when the task is not comparative.

### 4.6 Forms

- Labels remain visible; placeholders provide examples, never instructions.
- Errors appear next to the field and are announced.
- Use progressive disclosure for uncommon or technical settings.
- Show saved, unsaved, saving, conflict, and offline state persistently for long forms.
- Place previews beside configuration where the user is shaping a visible artifact.
- Use sticky actions for long forms; avoid independent save buttons that make ownership unclear.

### 4.7 Empty, loading, and error states

- Loading uses structural skeletons for tables, cards, and dashboards.
- An actionable empty state has one direct next action.
- A filtered empty state offers “Clear filters”.
- A failed region keeps its error and retry action in that region.
- Toasts confirm completed actions; they are not the only channel for critical failure.

## 5. Component friction report

| Priority | Current friction | Replacement |
| --- | --- | --- |
| P0 | Clickable table rows are mouse-only | Full-row link or keyboard-activated row with focus styling and accessible name |
| P0 | Placeholder-only table search | Label, search icon, clear action, and result count |
| P0 | Critical failures can be toast-only | Persistent contextual error with retry; toast remains supplementary |
| P0 | Scanner feedback can be mistaken for completion | Shared Ready / Saved on device / Confirmed / Needs attention state model |
| P1 | Page, section, modal, and empty state all encourage subtitles | Title/state/action-first component APIs; descriptions opt-in |
| P1 | Cards use several radii and elevations | 6 px controls, 8 px surfaces, border-only inline containers, overlay elevation only |
| P1 | Several actions receive equal visual weight | One primary action; overflow exceptional actions |
| P1 | Fixable empty states explain navigation in prose | Direct CTA in the empty state |
| P1 | Form builders expose internal keys, locale codes, and option values | Generate internals; show primary content first; translations/advanced under disclosure |
| P1 | Admin sidebar expands by individual page | Capability-based workspaces with local navigation |
| P2 | Auth uses large decorative blur glows | Quiet canvas or small brand artwork using shared tokens |
| P2 | Cookie notice hardcodes zinc colours and English | Localize and tokenize while preserving the Ursula/political joke |
| P2 | Pagination contains hardcoded English | Full localization and page semantics |
| P2 | Custom uppercase/tracking is used as generic hierarchy | Use scale, weight, and colour; reserve uppercase for real codes |

## 6. Core flow audit

### 6.1 Visitor to application (H1, H11-H12, H49)

Current friction:

- Public application CTAs route to generic signup and do not reliably preserve the selected form.
- Applicants must rediscover the form after account creation or verification.
- Application cards repeat the same Apply action instead of making the object itself the destination.

Target flow:

1. Select an application from the public page.
2. Create an account with a same-origin return destination.
3. Verify email without losing draft or form context.
4. Land directly in the chosen form.
5. Save draft automatically or through a persistent action.
6. Submit with an explicit summary of required logistics and sensitive-data handling.
7. Follow a visible timeline: Draft → Submitted → Review → Decision → Confirm place.

### 6.2 Verification and recovery (H2-H5)

- Keep pages readable while gating transactional actions contextually.
- Replace the global banner as the primary interaction with “Verify email to submit/confirm”.
- Show resend cooldown beside the action.
- Treat already-used verification links as success, not failure.
- Return to the interrupted task after verification or password reset.

### 6.3 Invitation onboarding (H9-H10)

Invitation context determines the flow:

- Sponsor: account → identity → company workspace.
- Staff: account → profile/logistics details → relevant work tools.
- Late participant: account → required logistics details → closed application form.

Do not ask administrators to enter personal data on someone else’s behalf. Clearly show onboarding completion and the destination that access unlocks.

### 6.4 Application creation (H11)

Replace the large metadata modal and exposed schema editor with:

1. Basics: name and person type.
2. Availability: opening, closing, capacity, confirmation window.
3. Questions: applicant-facing labels and answer types.
4. Review: participant preview and publication state.

Generate keys from the primary label. Keep translations, option values, and file restrictions under contextual “More options”. Keep a persistent save state.

### 6.5 Review, decision, and confirmation (H13-H15)

Review and admissions are separate workspaces or clearly separated tabs:

- Review: assigned submissions, individual score, notes, autosave.
- Decision: reviewed candidates, capacity, internal decision, bulk operations.
- Communication: unsent decisions, delivery status, skipped/failed recipients.
- Confirmation: deadline, confirmed/declined/expired, re-offer or revoke actions.

“Accepted internally” must never resemble a communicated acceptance. Batch partial failures need a durable result panel, not only a toast.

### 6.6 Projects and Devpost (H16-H21)

- Preserve the Upload → Review → Import stepper.
- Preview must visibly state that it performs no writes.
- Reconciliation separates unmatched people, ambiguous matches, and prize mappings.
- Hot project edits must preview queue consequences before confirmation.
- Participants receive a read-only project view except for policy-enabled initial creation.
- Story identifiers and implementation words must not appear in UI copy.

### 6.7 Accreditation and badge rotation (H22-H23, H28)

Default interaction:

1. Scan ticket.
2. Confirm person and eligibility.
3. Scan/enter physical badge.
4. Wait for server acknowledgement.
5. Show confirmed accreditation.

Badge replacement lives as an exceptional action on the person card. It clearly identifies old and new badges, revocation state, and Wallet consequences. Ticket and badge remain visibly distinct throughout the product.

### 6.8 Presence, meals, and activities (H24-H26)

- Scanner mode is explicit before scanning.
- Large scan target receives focus automatically.
- First serving and repeat serving have different confirmation treatments.
- Dietary restrictions dominate the meal result without exposing unnecessary profile data.
- Pending device operations remain visible across navigation and restart.
- Manual backdated presence uses a timeline editor bounded by valid adjacent events.
- Conflicts are explained through the timeline, not database terminology.

### 6.9 Statistics (H27)

Use phase-based dashboards:

- Before: applications, funnel, decision delivery, confirmation latency, shirts, dietary distribution.
- During: accreditation, current/estimated presence, meals, activities, queue progress.
- After: attendance hours, evaluations, exports, privacy operations.

Dietary reporting is visibly fixed to confirmed attendees. Distinguish actual, estimated, and incomplete data. Every chart must have a table or textual alternative.

### 6.10 Queue and judging (H29-H40)

The live workspace uses four physical states:

1. Called
2. In room
3. Presenting
4. Scored

“Bring in” and “Start presentation” remain separate primary actions. Exceptional states include cross-room conflict, called too long, skip without position loss, send back, requeue, no-show, disqualification, and pause.

Judging requires persistent collaborative state:

- Saving / Saved / Offline / Conflict
- Judges currently editing
- Criterion-level updates
- Draft versus submitted evaluation
- Corrections after submission and version history
- Attribution of score changes

The operator and judge share the room context but see actions based on capability. The most likely safe next action is visually dominant.

### 6.11 TV broadcast (H41-H42)

- Show a live preview and the current broadcast mode.
- Separate editing from broadcasting.
- Confirm urgent full-screen announcements.
- Display automatic expiry before broadcast.
- Mask secrets in administration and preview them deliberately.
- Show delivery/connection state for the screen fleet.

### 6.12 Sponsor workspace (H43-H46)

Provide a scoped workspace containing:

- Company profile completeness
- Challenge draft, scheduled reveal, and public state
- Prize and criteria builder
- Immutable version history
- Judge invitations and room assignments
- Evaluations, ranking, and exports
- External judging mode when queue tools are not used

Sponsor data remains scoped by ownership even when shared components match administration.

### 6.13 Programme, announcements, and notifications (H45, H47-H52)

- Schedule items show draft, scheduled, public, active, and ended states.
- Meals and scannable activities are recognizable types, not hidden flags.
- Announcements show channel, audience, window, and broadcast state.
- Notification preferences separate mandatory operational categories from optional channels.
- Mandatory rows display “Always on” with a lock; they are not disabled switches.

### 6.14 Audit and privacy (H53-H54)

- Audit uses human-readable action labels, actor, object, time, and origin; raw identifiers are secondary.
- Filters are composable and reflected in export.
- Account removal first checks eligibility.
- Fresh accounts may be deleted; historically referenced accounts are anonymized.
- The confirmation names retained operational history and revoked access.

## 7. Interaction and accessibility audit

### Critical

- Convert mouse-only navigation rows to links or fully keyboard-operable controls.
- Label all search inputs independently of placeholders.
- Keep visible focus on buttons, rows, tabs, menus, and dialogs.
- Preserve focus when dialogs close and return it to the trigger.
- Announce critical form errors and synchronization failures.
- Do not rely on colour for queue, decision, connection, or scan state.

### High

- Associate helper and error text with its control.
- Make busy states programmatically available and prevent accidental repeat submissions.
- Use AlertDialog for destructive or irreversible actions.
- Ensure charts expose exact values outside hover-only tooltips.
- Provide explicit accessible names for icon-only scanner, removal, menu, and sorting controls.

### Responsive and mobile

- Respect safe-area insets for fixed actions and scanner feedback.
- Keep primary touch targets at least 44 points on mobile.
- Do not make critical scan actions dependent on small overflow menus.
- Avoid horizontally scrolling data tables when a drill-down layout can preserve the task.

## 8. Microcopy and anti-AI audit

### Rules

1. Titles name the object or task.
2. Buttons use a verb and concrete object where ambiguity exists.
3. Descriptions explain only risk, consequence, policy, or an unfamiliar state.
4. Placeholders contain examples, not instructions.
5. Avoid “below”, “navigate”, “manage”, “seamlessly”, “get started”, and enumerations of visible content.
6. Never expose story numbers, capability keys, API concepts, or internal state names to ordinary users.
7. Preserve deliberate brand personality when it is specific and human. The cookie notice’s political joke is explicitly retained.

### Before/after sheet

| Before | After or UI replacement |
| --- | --- |
| “Sign in to hackOS.” | Omit; title and fields are sufficient |
| “See what matters for the event at a glance.” | Omit; order dashboard content by urgency |
| “The next activity on the schedule.” | Omit; “Next up” is sufficient |
| “Presenting teams, called teams, next queue head, and fast operator actions.” | Omit; use labelled physical-state columns |
| “Create rooms in Administration to start building queue views.” | Title “No rooms yet” plus Create room action |
| “Create or select a judging room before operating the queue.” | “Choose a room” and focus the selector |
| “Find the person (ticket, badge, name or email)…” | Separate Scan ticket and Search person modes |
| “The accreditation scan capability is required.” | “Ask an administrator for accreditation access.” |
| “Announcements require the announcements:manage capability.” | “Ask an administrator for announcement access.” |
| “Search the user directory by name or email.” | Omit; label the field Search users |
| “Click a group to edit it.” | Omit; use linked rows with chevrons |
| “Rename the group or update its description.” | Omit; labelled inputs are sufficient |
| “Type-free confirmation: click delete…” | Omit; confirmation actions are self-evident |
| “H19: lets each participant create…” | “Participants can create their own projects.” |
| “Each chosen challenge appends the team… (H21)” | “The project joins the end of each selected challenge queue.” |
| “Sponsor organisations. Create one before inviting…” | Omit; show representative count and an empty-state CTA |
| “Provide the label in every locale…” | “Add all three translations.” plus completion indicators |
| “Upload or paste the two Devpost CSV exports…” | “Nothing imports until you confirm.” plus a stepper |
| Generic “Pending” for an offline scan | “Saved on this device” |
| “Nothing to show” | Contextual “No users”, “No applications”, or “No results” |
| “Turn off” on mandatory queue alerts | Locked “Always on” row |
| “Delete account” before eligibility is known | Show Delete or Anonymize after eligibility check |
| “Legally-required cookie notice” | Keep the playful title/body and Ursula joke; localize and use shared tokens |

## 9. Delivery plan

### Wave 1 — shared foundations

1. Design tokens, surfaces, page hierarchy, and copy rules.
2. Accessible data tables, errors, empty states, and loading patterns.
3. Capability-based workspace navigation.

### Wave 2 — critical journeys

4. Identity, verification, invitation, and application continuity.
5. Review, decision, communication, and confirmation workflow.
6. Queue/judging physical states and collaborative save state.
7. Offline scanner synchronization and recovery feedback.

### Wave 3 — scoped workspaces

8. Sponsor, programme, announcements, TV broadcast, statistics, and privacy workspaces.
9. Cross-platform terminology and localization sweep.

### Definition of done for every issue

- References relevant Hxx stories.
- Supports capability combinations rather than fixed roles.
- Covers loading, empty, error, success, disabled, and permission-denied states.
- Provides keyboard, focus, accessible-name, and announcement behaviour.
- Updates Spanish, Galician, and English together.
- Uses shared tokens and primitives.
- Includes responsive web verification and real-device verification where native/offline behaviour applies.
- Adds or updates tests for state transitions and interaction semantics.

## 10. Evidence and implementation hotspots

- Colour/radius foundation: `apps/web/src/app/globals.css`
- Shared page hierarchy: `apps/web/src/components/common/page-header.tsx`
- Repeated section-description pattern: `apps/web/src/components/common/section-card.tsx`
- Table search and clickable rows: `apps/web/src/components/common/data-table.tsx`
- Capability-filtered web navigation: `apps/web/src/lib/nav.ts`
- Capability-filtered mobile tabs: `apps/mobile/lib/tabs.ts`
- Application builder: `apps/web/src/app/(app)/applications/[id]/page.tsx`
- Live judging: `apps/web/src/app/(app)/judging/page.tsx`
- Scanner synchronization model: `apps/mobile/lib/scanner-sync.ts`
- Sponsor/challenge lifecycle: `apps/web/src/app/(app)/challenges/[id]/page.tsx`
- Event settings: `apps/web/src/app/(app)/settings/event/page.tsx`
- Product copy: `apps/web/src/lib/i18n.ts` and `apps/mobile/lib/i18n.tsx`

## 11. Delegation issue map

The audit has been split into agent-ready GitHub issues. The intended order is foundations first, critical domain flows second, and the cross-platform copy sweep after terminology stabilizes.

Delivery is tracked in [#197 — UX audit delivery epic](https://github.com/danicallero/hackOS/issues/197).
The recommended concurrency waves, dependency gates, worker prompt, and merge policy are documented in [`docs/ux-ui-agent-launch-guide.md`](./ux-ui-agent-launch-guide.md).

### Foundations

- [#185 — Unify design tokens, surfaces, page hierarchy, and action priority](https://github.com/danicallero/hackOS/issues/185)
- [#186 — Make tables, search, errors, and empty states keyboard-safe and contextual](https://github.com/danicallero/hackOS/issues/186)
- [#187 — Reorganize web and mobile navigation into capability-based task workspaces](https://github.com/danicallero/hackOS/issues/187)

### Critical journeys

- [#188 — Preserve task intent through identity and invitation onboarding](https://github.com/danicallero/hackOS/issues/188)
- [#189 — Separate application review, decisions, communication, and confirmation](https://github.com/danicallero/hackOS/issues/189)
- [#190 — Redesign queue and judging around physical states and collaborative save status](https://github.com/danicallero/hackOS/issues/190)
- [#191 — Expose offline scanner synchronization truth and recovery](https://github.com/danicallero/hackOS/issues/191)

### Scoped workspaces

- [#192 — Build the sponsor workspace](https://github.com/danicallero/hackOS/issues/192)
- [#193 — Unify programme publication, announcements, TV, and notification preferences](https://github.com/danicallero/hackOS/issues/193)
- [#194 — Create phase-based statistics and explicit privacy-data lifecycle](https://github.com/danicallero/hackOS/issues/194)
- [#195 — Add progressive event settings and live previews](https://github.com/danicallero/hackOS/issues/195)

### Final system sweep

- [#196 — Complete the cross-platform anti-AI microcopy and localization sweep](https://github.com/danicallero/hackOS/issues/196)
