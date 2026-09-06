# Agent Instructions

This file is for any coding agent working on hackOS — Claude Code, Codex,
Cursor, or anything else. Nothing here depends on a specific tool: `CLAUDE.md`
is a plain markdown file that Claude Code happens to auto-load; every other
agent reads it the same way it reads this one, as the first step below. The
`.claude/` paths referenced later (skills, rules, reflections) are also just
files — read them directly if your harness has no built-in concept of
"skill" or "rule".

hackOS uses a single source of truth for all coding agents. **Read `CLAUDE.md`
first** — it contains every non-negotiable convention, the layout, dev
commands, and the documentation-sync rules. The rest of this file tells you
*what else to read* before writing code.

## Prescribed reading order

1. **`CLAUDE.md`** — conventions every change must follow (traceability,
   capability-based auth, audited mutations, transactional state transitions,
   raw SQL, trilingual copy).
2. **`plan/historias-hackos.md`** — the functional source of truth. If any
   doc conflicts with this file, this file wins.
3. **`plan/07-datos-relevantes-ers.md`** — hard invariants (permission model,
   idempotency, concurrency, SSE broadcast rules).
4. **`docs/README.md`** — documentation index. Read the module doc that
   matches your task.

## Domain-specific reads

Before touching code in a domain, read the matching doc:

| You're working on | Read |
|---|---|
| `apps/api/src/modules/<domain>/` | `docs/api-reference.md` (module/convention map), or `docs/challenges-devpost.md` (challenges/projects), or the relevant `docs/*.md` file |
| Queue / judging / rooms | `docs/background-workers.md` (tick model, event map) |
| `apps/web/` | `apps/web/README.md` (component library, conventions) |
| `apps/mobile/` | `docs/mobile.md` (what's built), `docs/mobile-release.md` (build/release) |
| Any UI surface | `docs/DESIGN.md` (tokens, containers, accessibility, copy rules) |
| Navigation | `docs/navigation.md` (capability → workspace mapping) |
| Deployment / env vars | `deploy/README.md` + `docs/env-vars.md` |
| Capabilities or events | `packages/shared/src/capabilities.ts` and `events.ts` (never inline strings) |

## Engineering discipline

The same things an experienced engineer does without being told — spelled
out because agents skip them under time pressure:

- **Search before you build.** Grep the module for the thing you're about to
  add before adding it — a helper, a constant, a component. Check
  `docs/README.md` for a doc covering the area, and `packages/shared` for an
  existing capability/event name. Reimplementing something that already
  exists is a bug, not a shortcut.
- **Delete code nothing calls.** Don't comment it out, don't leave it "in
  case it's needed later" — git history is that case. If a change makes a
  file, export, or dependency unreachable, remove it in the same change.
- **Match effort to the problem.** A bug fix doesn't need a new abstraction;
  a one-off script doesn't need a config system. Three similar lines beat a
  premature helper. Don't add a layer, a flag, or a fallback for a case that
  can't happen yet.
- **Docs before code, code before spec.** If you need to understand how
  something works, read the doc for that area first
  (`docs/README.md` → the matching file). If none exists, write one as part
  of your change instead of leaving the next reader to re-derive it from
  code. Only touch `plan/historias-hackos.md` or
  `plan/07-datos-relevantes-ers.md` as a last resort, and never to make them
  match code you just wrote — see "Things not to do" below.

## Skills, rules and reflections

- **Skills** (`.claude/skills/<name>/SKILL.md`) are specialized, executable
  workflows — currently just `verify` (build/launch/drive hackOS locally to
  check a change end-to-end). Before a non-trivial task, check whether a skill
  already covers it; if one does, follow its `SKILL.md` instead of
  reinventing the workflow.
- **Rules** (`.claude/rules/`) hold operational policies that don't fit
  `CLAUDE.md` or `docs/`. It's currently empty — most rules already live in
  `CLAUDE.md`, `plan/`, or `docs/DESIGN.md`; check there first.
- **Reflections** (`.claude/reflections/lessons.md`) are lessons learned from
  user corrections. Read it when you're unsure how to proceed on something
  that has plausibly come up before. If the user corrects your approach
  mid-task, write or update a reflection per `.claude/reflections/README.md`
  — but only if the lesson generalizes beyond the current task; don't persist
  one-off instructions.

## Instruction precedence

When instructions conflict, resolve in this order (most specific wins):

1. The user's explicit instruction for the current task
2. Platform/security constraints
3. A module-specific rule you've found in code or `docs/`
4. An active skill's `SKILL.md`
5. `AGENTS.md` (this file)
6. `.claude/rules/`
7. `.claude/reflections/lessons.md`
8. Conventions inferred from surrounding code

A correction the user gives you for the current task does not silently
rewrite a permanent rule — if it should, say so explicitly and update the
canonical doc (see promotion path in `.claude/reflections/README.md`).

## Startup flow for a new task

```text
Read AGENTS.md (this file, if not already in context)
      │
      ▼
Identify the affected domain/module
      │
      ├── matching docs/*.md section
      ├── .claude/rules/ (if any apply)
      ├── .claude/reflections/lessons.md (if a past correction applies)
      └── .claude/skills/ (if a skill covers this workflow)
      │
      ▼
Read the actual code for that module — don't assume from doc titles or
comments; verify behavior against apps/api/src/modules/<domain>,
apps/web/src/, or apps/mobile/ directly
      │
      ▼
Make the change (code + the doc it affects, in the same commit — see
CLAUDE.md's Documentation table)
      │
      ▼
Run the validation for the area you touched (below)
```

Don't read the whole repo for every task — load only what the task's domain
touches.

## Things not to do without understanding the consequences

- Don't edit an applied migration under `apps/api/db/migrations/` — it's
  immutable once applied (checksum-enforced); write a new migration instead.
- Treat `plan/` as read-only by default — it wins over every other doc when
  something conflicts. Editing it is a last resort, not a first move: if a
  story is genuinely wrong or outdated, say so explicitly and let a human
  decide, rather than silently rewriting it to match the code you just
  wrote or working around the mismatch in silence.
- Don't add a capability or event string inline — add it to
  `packages/shared/src/capabilities.ts` / `events.ts` first.
- Don't bypass `requireCapability`/audit/idempotency/transaction conventions
  in `CLAUDE.md` to make a fix land faster — those are invariants, not style.
- Don't invent an H-number for something that isn't in
  `plan/historias-hackos.md` (e.g. for a GitHub issue with no story) — link
  the issue directly instead.

## Before you finish

Run these from the repo root and ensure they pass:

```sh
pnpm lint                          # biome + copy check
pnpm --filter @hackos/api test     # API integration tests (if you changed API code)
pnpm --filter @hackos/web typecheck # web type check (if you changed web code)
pnpm --filter @hackos/web test     # web unit tests (if you changed web code)
```

If your change alters what a screen looks like (mobile or web), also run it and
post screenshots of the changed states in a PR comment — reviewers must be able
to see the change without building it. Recipe and gotchas:
[`docs/ui-testing.md`](./docs/ui-testing.md) § Screenshots on UI PRs.

## Opening a PR

Use [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md)
as the PR body — fill in every section (delete Screenshots/Migration only if
truly not applicable), don't replace it with a free-form summary.
