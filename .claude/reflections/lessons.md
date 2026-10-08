# Lessons

## [R001] Validate tests before committing

Status: active
Scope: repository
Source: user-correction
Date: 2026-09-08

### Trigger
Before committing any code or documentation change.

### Mistake
A change was committed and the CI later exposed broken route-policy tests that
could have been caught locally.

### Lesson
The pre-commit check must include the tests affected by the change, plus the
repository's required lint and type checks where applicable.

### Action
Run the relevant focused tests first, then the required package checks. Do not
commit until failures are understood and either fixed or explicitly reported
as an environmental blocker.

### Validation
Confirm the test command exits successfully and inspect its summary; a test
process that hangs, is interrupted, or reports failures does not count as
validated.

### Exceptions
None for source changes. Documentation-only changes may skip package tests,
but must still run the checks relevant to the edited documentation or tooling.

## [R002] Treat “PR” as an imperative request

Status: active
Scope: repository
Source: user-correction
Date: 2026-09-09

### Trigger
When the user says “PR” in the context of a completed change.

### Mistake
The agent treated the short message “PR” as ambiguous and asked whether the
user wanted a pull request opened.

### Lesson
“PR” means the user wants the pull request opened, not a clarification about
whether to do so.

### Action
Use the repository's pull-request workflow immediately: inspect the branch and
worktree, run the required checks, prepare the required PR body, and open the
pull request. Ask only if a real external-state blocker prevents opening it.

### Validation
Confirm the pull-request command succeeds and report the resulting URL or the
concrete blocker.

### Exceptions
If the user explicitly says “draft”, “review”, or otherwise narrows the PR
request, follow that more specific instruction.

## [R003] Verify URL synchronization under rerenders

Status: active
Scope: repository
Source: user-correction
Date: 2026-09-09

### Trigger
When a client component synchronizes tabs, filters, dialogs, or other local
state with the browser URL.

### Mistake
A URL setter changed identity across renders and wrote the already-canonical
value repeatedly from an effect, eventually exceeding the browser's
`history.replaceState` rate limit. Static checks did not expose the loop, and
runtime verification happened only after committing.

### Lesson
URL synchronization must be idempotent and stable under unrelated rerenders.
Never call `pushState`, `replaceState`, `router.push`, or `router.replace` when
the canonical target already matches the current URL.

### Action
Keep URL mutation callbacks referentially stable, read changing navigation
inputs through a current ref when needed, and guard same-value writes before
calling the router. Perform runtime interaction verification before committing
URL-synchronized UI changes.

### Validation
Add tests proving that the setter remains stable across rerenders and that
selecting the current canonical value performs no history mutation. Exercise
the affected interaction in a running browser and confirm no repeated requests,
navigation, or runtime security error occurs.

### Exceptions
An intentionally repeated navigation is allowed only when the product behavior
explicitly requires a refresh and uses a dedicated refresh action rather than
implicit state synchronization.

## [R004] Preserve context across disclosure layout changes

Status: active
Scope: repository
Source: user-correction
Date: 2026-09-10

### Trigger
When expanding or collapsing a card, accordion, inspector, or other sizeable
progressive-disclosure region in a scrollable page.

### Mistake
The disclosure changed document height without preserving a visible anchor, so
collapsing a long card left the viewport showing unrelated items farther down.

### Lesson
Disclosure must preserve spatial context. After a large region changes size,
the control or card the user acted on should remain visible at the same useful
viewport position whenever possible.

### Action
Use an explicit disclosure control, capture its viewport position before the
state update, and restore the resulting card to that anchor after the update.
For long expanded regions, keep the collapse control reachable without relying
on click-outside behavior.

### Validation
Open and close short and long items near the top, middle, and bottom of a real
scrolling viewport. Confirm the acted-on item remains visible, then repeat with
keyboard activation and at a narrow width.

### Exceptions
Navigation to a deliberately focused destination or a user-requested “jump to”
action may intentionally change scroll position.

## [R005] Use the requested Codex model for delegated work

Status: active
Scope: repository
Source: user-correction
Date: 2026-09-15

### Trigger
When the user asks for delegated subagents with a named Codex model.

### Mistake
The task was delegated through the generic orchestration wrapper, which used
the default model instead of the requested Luna CLI invocation.

### Lesson
Delegation is part of the requested workflow: use the named model and launch
mode exactly, while keeping each delegated task narrowly scoped.

### Action
Launch delegated Luna work with `codex --yolo -m gpt-5.6-luna` and verify the
session reports that model before relying on its result.

### Validation
Inspect the spawned session header or command output for the requested model,
and ensure the agent has a disjoint task and does not overwrite unrelated work.

### Exceptions
If the requested model is unavailable, report that blocker rather than
silently substituting the default model.

## [R006] Let layout carry hierarchy before adding containers

Status: active
Scope: repository
Source: user-correction
Date: 2026-10-01

### Trigger
Composing detail pages, lists, or participant workflows.

### Mistake
Nested cards surrounded every member and challenge, while badges decorated
static metadata. The single-project participant had to navigate a catalogue.

### Lesson
Apply `docs/DESIGN.md` §3 deliberately: start with spacing, aligned headings
and columns. Containers need a bounded purpose; badges need actual state.
Optimize the primary layout for the common case without removing exceptions.

### Action
Use open sections for related page content, with quiet hairlines where spacing
alone leaves row ownership ambiguous. Removing cards does not mean removing
all boundaries. Repeated inbox/list rows still need clear ownership: use quiet
hairlines, restrained neutral washes and distinct subject/meta/body hierarchy.
Validate with several adjacent records, not just one isolated item. Keep static metadata as text and secondary multi-record
navigation available without making it the default.

### Validation
Inspect real desktop and narrow screenshots, including a single record,
multiple records, and independent simultaneous states.

### Exceptions
Distinct participant contexts (project details, team, judging and delivery)
justify section surfaces when open sections fail to communicate ownership.
Keep their contents as rows rather than nested cards. Dense operational tables,
overlays and truly selectable/bounded objects still justify surfaces; meaningful changing states still justify status badges.

## [R007] Review feedback copy at its call sites

Status: active
Scope: module:web
Source: user-correction
Date: 2026-10-01

### Trigger
When changing shared feedback to separate a compact heading from expanded detail.

### Mistake
The shared toast handled overflow, but its generic headings did not identify
the action that produced the message.

### Lesson
A layout fix does not complete a semantic copy change. Each caller must name
its own action or event, with room for all supported translations.

### Action
Inventory callers, reuse concise localized action labels, and retain the full
explanation in the body. Check dynamic messages and helpers with several actions.

### Validation
Audit caller coverage and render representative feedback at narrow widths in
every supported language, confirming that headings fit and reasons remain visible.

### Exceptions
A generic fallback may protect unknown callers, but does not replace reviewing
the callers within the requested scope.

## [R008] Keep the primary operational action direct

Status: active
Scope: module:mobile
Source: user-correction
Date: 2026-10-02

### Trigger
Adding alternative input methods to a frequent operational action.

### Mistake
A method chooser made the normal action require another interaction and gave
fallback methods too much prominence.

### Lesson
Keep the preferred method directly available. Secondary methods belong in a
compact native menu; an explicit method chooser suits actions where the user
needs to decide how to proceed.

### Action
Count taps along the common path before and after adding alternatives. Preserve
required domain decisions, but avoid adding a method choice before the default.

### Validation
Verify that the primary action starts its input immediately and that alternatives
remain reachable through an accessible secondary control.

### Exceptions
Destructive actions, mandatory domain choices and explicit replacement workflows
may need a confirmation or method dialog.

## [R009] Preserve intentional product voice during copy audits

Status: active
Scope: repository
Source: user-correction
Date: 2026-10-03

### Trigger
Auditing interface copy for verbosity or generic wording.

### Mistake
Removed the Ursula cookie notice's humor and illustration as presumed unwanted copy, although they were deliberate human design choices.

### Lesson
Intentional humor and brand character are not evidence of poor copy. Evaluate whether wording obstructs the task before removing its personality.

### Action
Preserve established product voice, including the Ursula cookie notice. Focus edits on redundancy, ambiguity, and unnecessary explanations.

### Validation
Check that copy revisions improve comprehension while retaining deliberate character and existing visual identity.

### Exceptions
Change intentional voice when the user requests it or it creates a concrete comprehension problem.

Active reflections for hackOS. See `README.md` in this directory for the
format, classification flow, and promotion path.

## [R010] Align multi-column fields independently of helper text

Status: active
Scope: repository
Source: user-correction
Date: 2026-10-03

### Trigger
When building or auditing inputs in two or more columns, especially when only
some fields have helper text, validation errors, or timezone previews.

### Mistake
Grid children stretched to the tallest field, distributing a shorter
FormItem's internal rows and pushing its label and input below its neighbors.

### Lesson
Align field labels and controls, not the bottom of each field's entire content.
Helper text and errors belong below the control and must not shift neighboring
labels or inputs.

### Action
Use start alignment for field containers (for example, `grid items-start`) and
inspect mixed-help rows. If translated labels wrap to different heights, use
shared label/control tracks rather than aligning entire fields to the bottom.

### Validation
Compare label and input top edges in desktop screenshots and browser geometry.
Repeat with one help message, multiline help, one validation error, translated
labels, and the stacked mobile layout.

### Exceptions
An action deliberately aligned with a control is not a second form field;
it may align to that control, independently of the help below it.

## [R011] Keep event settings within their save scope

Status: active
Scope: module:event
Source: user-correction
Date: 2026-10-03

### Trigger
Adding controls to an existing event-settings category.

### Mistake
A reminder section sat outside the category form and introduced independent
scheduling buttons, then repeated the selected date in a separate status line.

### Lesson
A category's sections share its form, save footer and unsaved-change guard.
Show optional scheduling controls only when enabled; do not repeat field values
in status copy.

### Action
Use the existing category form and save transaction. Match adjacent sections'
heading hierarchy and control spacing. Keep audience copy brief. Auditing ordinary
configuration must not create a mandatory justification field: record actor,
time and changed values automatically. Reserve requested reasons for actual
exceptions or decisions whose policy requires them.

### Validation
Capture the section with the common Save changes footer and test that an
invalid schedule rolls back the accompanying event-settings changes.

### Exceptions
A separate action with a genuinely distinct lifecycle, such as destructive
maintenance, may keep its own explicit action.

## [R012] Preserve official Wallet badge artwork

Status: active
Scope: module:logistics
Source: user-correction
Date: 2026-10-03

### Trigger
Displaying Add to Apple Wallet or Add to Google Wallet actions on any surface.

### Mistake
Email rendered Wallet links as generic branded text buttons.

### Lesson
Reuse the official artwork already shipped in `apps/web/public/wallet-badges`.
Keep its aspect ratio and localized variant; email may use PNG exports of the
same SVGs for client compatibility.

### Action
Use image links with meaningful alternative text. Galician follows the existing
Spanish artwork fallback.

### Validation
Inspect the rendered surface and verify links contain the official badge images.

### Exceptions
The plain-text MIME part retains readable labeled links.

## [R013] Check reflections throughout each task

Status: promoted
Scope: repository
Source: user-correction
Date: 2026-10-04
Promoted-To: CLAUDE.md

### Trigger
Before and during any code, documentation, test, or configuration change.

### Mistake
An agent reviewed reflections once but did not keep checking later changes
against the lessons, so a known mistake could recur while completing the task.

### Lesson
Reflections are an ongoing check for the entire task, not a one-time startup
reading.

### Action
Read the entire lessons file before editing. Compare the intended work with
applicable active lessons, re-check substantive diffs as work proceeds, and
apply each lesson's validation before commit or PR. Resolve conflicts
explicitly when higher-priority instructions or current product requirements
take precedence.

### Validation
Confirm applicable lessons were considered at planning, during implementation,
and during final diff/validation review.

### Exceptions
None.

## [R014] Keep nested menus flowing in one direction

Status: active
Scope: module:web
Source: user-correction
Date: 2026-10-04

### Trigger
Building multi-level dropdowns or filter menus with nested detail panels.

### Mistake
A child menu opened back toward its parent despite enough room in the
direction used by the parent submenu, making the menu flow alternate sides.

### Lesson
Nested menu levels should keep the same opening direction while space allows.
Let collision handling reverse a submenu only when the preferred side does not
fit in the viewport.

### Action
Set direction at the menu root so nested submenus inherit it, and keep text
direction separate where needed. Check the default side at a wide viewport and
the collision fallback near the viewport edge. Match directional indicators to
the preferred opening direction.

### Validation
Open every level in a real browser with ample space and confirm that each uses
the same side. Repeat near the viewport edge and confirm only the submenu that
cannot fit flips, without creating a navigation loop or trapping focus.

### Exceptions
Menus that intentionally represent independent navigation layers may use
different directions when their hierarchy and visual design make that choice
clear.

## [R015] Reproduce interaction failures before changing rendering layers

Status: active
Scope: repository
Source: user-correction
Date: 2026-10-04

### Trigger
A visual element disappears or flickers during hover, especially after a prior
attempt to fix the same interaction failed.

### Mistake
Repeatedly adjusting overlay ordering without inspecting the actual rendered
state attributed missing chart paint to the wrong cause.

### Lesson
Reproduce the interaction and inspect the element's paint, geometry, and state
before choosing a fix. Consult the library's documentation and implementation
when its automatic interaction behavior is involved.

### Action
Capture the failing state, identify which property changes, and verify the
proposed cause against runtime evidence before changing code.

### Validation
Repeat the same pointer interaction after the change, including related entry
points such as legend hover, and confirm the element retains valid paint and
geometry. State which browser was checked.

### Exceptions
A directly observable code error can be fixed first, but its affected
interaction still needs runtime verification.

## [R016] Verify that interaction feedback is perceptible

Status: active
Scope: module:web
Source: user-correction
Date: 2026-10-05

### Trigger
Designing or changing hover, pressed, or other visual action states.

### Mistake
The primary button changed color on hover and passed text-contrast checks, but
its small color difference was too subtle for the user to notice.

### Lesson
Legible labels and different CSS values do not establish a perceptible state
change. Interaction feedback must remain visible in the actual interface.

### Action
Compare default, hover and pressed states in a running browser, in both themes.
Inspect computed paint values and side-by-side captures; strengthen feedback
when the difference is barely visible while preserving text contrast.

### Validation
Exercise pointer entry and press, inspect the rendered state change, and verify
that disabled and touch-only controls do not acquire hover feedback. Keep a
regression check for the corrected state distinction when appropriate.

### Exceptions
Controls deliberately lacking hover behavior, including touch-only surfaces.

## [R017] Validate page patterns with representative compositions

Status: active
Scope: module:web
Source: user-correction
Date: 2026-10-08

### Trigger
Building or applying a shared page/surface pattern across web routes.

### Mistake
A generic reading-width wrapper constrained table tabs; repeated fake fields
hid missing hierarchy in the playground. Save status was placed after Save
and duplicated its loading spinner.

### Lesson
Choose width by the content being shown, not by whether the route is called a
detail page. Shared patterns need representative content and rendered review.

### Action
Use the audited Users and application Responses layouts as the dense-list references.
Reuse their actual ListToolbar, FilterMenu and DataTable compositions rather
than reproducing them with loosely aligned buttons and repeated detail blocks. Keep mixed record
pages wide enough for their table tabs, constrain only text/form groups, and
verify the last column. Preview meaningful groups instead of filler fields.
Put save state at the leading edge, secondary actions then Save at the trailing
edge, and show only one pending spinner per save owner. Panel widths follow
content needs; multi-domain records remain full pages. Adapt mobile records
to readable rows and group related actions rather than replacing several
different actions with indistinguishable icons. Preserve an established viewer
and its empty state when improving layout; do not remove it because its data
is empty. Drag previews retain source dimensions and adjacent panes show the
space they will occupy before the drop is committed. Docking shows a single
placeholder at the actual active destination; hit-test areas stay invisible.
Inspect intermediate pointer positions, not only the final edge/drop state. Builders must show section
ownership, question boundaries and an explicit drop destination.

### Validation
Inspect actual desktop/narrow screenshots before claiming visual quality.
Compare new screens directly with those maintained references; passing flows
and having screenshots are not evidence that hierarchy or alignment is good.
Also compare the narrow header action row with Users; preserve its inline
layout, reducing labelled edit actions to accessible icons when necessary.
Check table geometry, useful field hierarchy, action order, pending feedback
and panel widths. Recheck each route after a shared pattern changes.

### Exceptions
Fixed operational workspaces and intentionally compact forms keep their
established geometry when it still supports their content and interaction.

## [R018] Preserve deployment fallbacks behind runtime editors

Status: active
Scope: module:wallet
Source: user-correction
Date: 2026-10-07

### Trigger
Adding database-backed runtime settings for a feature previously configured by
deployment environment.

### Mistake
Materializing default values in the settings row made deployment values stop
flowing through after the row was created.

### Lesson
Store only intentional overrides. An absent override must resolve to that
deployment's environment value, including after a manager resets it.

### Action
Keep override columns nullable, resolve defaults in the read path, and leave
fields equal to environment values unset on save. Expose a reset action.

### Validation
Save one field, confirm untouched columns remain null, reset, and confirm the
resolved values again match the deployment environment.

### Exceptions
Credentials and provider accounts remain deployment-only configuration.

## [R019] Preserve a matching session during token actions

Status: active
Scope: module:applications
Source: user-correction
Date: 2026-10-07

### Trigger
A public email token action is opened in a browser that already has a session.

### Mistake
Signing out every session interrupted the ticket holder who was already signed
in as the account named by the token.

### Lesson
The token remains scoped to its one action, but a matching existing session
should stay active. Close a different account's session before offering its app
entry point.

### Action
Compare the token result's user ID with the session user ID. Preserve and
refresh a match; close a mismatch and explain it.

### Validation
Exercise matching, different-account, and anonymous browser states. Confirm
Wallet requests still use the scoped token owner.

### Exceptions
Token endpoints that explicitly require fresh authentication follow their own
published session contract.

## [R020] Cover fresh installs when diagnosing native storage failures

Status: active
Scope: module:mobile
Source: user-correction
Date: 2026-10-08

### Trigger
Diagnosing a mobile failure attributed to cached data, migration, or cleanup.

### Mistake
Attributed an Android environment-switch failure only to an older roster,
although it also occurred before the first sign-in. The test double treated a
native directory URI getter as an inert string, hiding its path validation.

### Lesson
Storage initialization and native property getters can fail before any stored
data exists. A migration-shaped call path does not prove a migration-only bug.

### Action
Inspect the native adapter behind the failing operation and model the relevant
getter behavior in regression tests. Cover both a fresh install without prior
sign-in and an upgrade with existing data before narrowing the diagnosis.

### Validation
Verify that both cases fail against the previous implementation and pass with
the correction. Keep physical-device confirmation separate from mocked tests.

### Exceptions
A failure explicitly requiring an existing record may use that prerequisite,
provided the fresh-install path has been checked and does not access it.
