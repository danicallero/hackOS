# Reflections

A reflection is a lesson learned from a correction — the user telling an agent
it did something wrong, or confirming a non-obvious approach was right. This
directory is how that learning survives past one conversation.

Reflections are not a substitute for `CLAUDE.md`, `docs/`, or `plan/`. A
correction gets written here first because its scope isn't clear yet. Once a
lesson repeats or proves stable, promote it to its canonical home and mark it
promoted here — don't leave the same rule living in two places.

## When to write one

Classify the correction before writing anything:

```text
USER CORRECTION
       │
       ▼
CLASSIFY
       │
       ├── task-specific ──────► don't persist (it only applies to the change at hand)
       │
       ├── module-specific ────► lessons.md, Scope: module:<name>
       │
       ├── skill-specific ─────► lessons.md, Scope: skill:<name>
       │
       └── repository-wide ───► lessons.md, Scope: repository
```

A one-off ("don't touch that file in this PR") is task-specific — it doesn't
belong here at all. Only write a reflection when the lesson should change
behavior in a *future*, unrelated task.

Before writing, check `lessons.md` for an existing entry on the same topic.
Update it (bump `Date`, tighten the `Trigger`/`Exceptions`) instead of adding a
near-duplicate. If a new correction contradicts an existing lesson, resolve
the conflict in the entry itself — don't leave two contradictory active
lessons.

## Format

Each entry in `lessons.md` follows:

```markdown
## [ID] Short title

Status: active
Scope: repository | module:<name> | skill:<name>
Source: user-correction
Date: YYYY-MM-DD

### Trigger
When this applies.

### Mistake
What went wrong.

### Lesson
The generalized rule.

### Action
What to do next time.

### Validation
How to verify it.

### Exceptions
When the rule does not apply.
```

Don't store full conversation excerpts, secrets, or anything that only makes
sense as a temporary instruction for the current task.

## Promotion

`lessons.md` isn't meant to grow forever. Once a lesson is stable (it has
proven itself across more than one task, or the user has confirmed it as a
standing rule rather than a one-off), move it to its canonical source and mark
the entry `Status: promoted` with `Promoted-To: <path>`:

```text
operational convention  → CLAUDE.md
architecture decision   → docs/DESIGN.md or docs/architecture.md (or a new ADR if it needs history)
specialized workflow    → .claude/skills/<name>/SKILL.md
reusable policy         → .claude/rules/
```

There should be exactly one canonical place for any given rule. If you're
promoting into a file that already covers the topic, edit that section rather
than appending a redundant one.
