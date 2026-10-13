---
name: handoff
description: Wrap up the current task so another agent can continue it — write HANDOFF.md, push the branch, and report. Use when context, tokens or usage budget run low, or when stopping before the task is done.
---

# Handoff

Follow `AGENTS.md` § "Handoff notes". This skill is the checklist for doing it
in one pass.

## 1. Capture the state

```sh
git status --short
git log --oneline origin/staging..HEAD
gh pr view --json number,url,isDraft,headRefName 2>/dev/null
```

Note the last validation you ran and its result. If you have not run the
relevant checks since your last edit, run the cheapest ones that still apply
(`pnpm lint`, the focused test file, the app's typecheck) and record the
result, including failures.

## 2. Write `HANDOFF.md` at the worktree root

Overwrite it with the current state; it is a snapshot, not a log.

```md
# Handoff — <issue/task> (<one-line goal>)

- Branch: <branch> · PR: <url or "not opened"> · Base: <base branch / stacked on>
- Updated: <date time>

## Done
- <change> — <files> (tests: <added/updated>)
- Migrations: <file> (applied locally? yes/no)

## Left
1. <next concrete step, with file paths>
2. ...

## Open questions / decisions
- <question> — <who decides / what was assumed and why>

## Validation
- `<command>` → <pass/fail, counts, failing test names>

## Gotchas
- <infra state, env vars, flaky tests, things that look wrong but are intentional>
```

Every "Left" item must be actionable by someone with no access to your
conversation: name files, commands and expected results.

## 3. Keep it out of git

```sh
grep -qxF HANDOFF.md "$(git rev-parse --git-common-dir)/info/exclude" \
  || echo HANDOFF.md >> "$(git rev-parse --git-common-dir)/info/exclude"
```

## 4. Make the work recoverable

- Commit finished, validated work with the normal conventions (issue/story
  reference, no AI attribution). Commit unfinished work as a clearly marked WIP
  commit only if leaving it uncommitted would risk losing it; say so in
  `HANDOFF.md`.
- Push the branch. If a PR exists, add a short PR comment that the work was
  handed off and where the remaining steps are listed (do not paste
  `HANDOFF.md` if it contains local-only details).
- Never merge, never stop shared infrastructure, and never use bare
  `git stash` (the stash stack is shared across worktrees).

## 5. Report

End with a short message: what is done, what is left (top items), the PR or
branch, and the path to `HANDOFF.md`. If you are a dispatched Orca worker,
send this as your `worker_done` with `--outcome failed` when the task is not
complete, so the coordinator can reassign it.
