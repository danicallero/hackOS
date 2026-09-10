# Lessons

Active reflections for hackOS. See `README.md` in this directory for the
format, classification flow, and promotion path.

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
