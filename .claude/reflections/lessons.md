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
Dense operational tables, overlays and truly selectable/bounded objects still
justify surfaces; meaningful changing states still justify status badges.

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
heading hierarchy and control spacing. Keep audience copy brief.

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
