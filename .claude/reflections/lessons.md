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
