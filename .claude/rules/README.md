# Rules

This directory holds stable operational policies that were promoted out of
`.claude/reflections/lessons.md` and don't fit any existing canonical doc.

Most rules in this repo already have a canonical home and don't belong here:

- Coding conventions, permission model, audit/idempotency/concurrency
  requirements → `CLAUDE.md`
- Functional behavior and hard invariants → `plan/historias-hackos.md`,
  `plan/07-datos-relevantes-ers.md`
- Architecture and design system → `docs/DESIGN.md`, `docs/architecture.md`,
  the rest of `docs/`

Only add a file here for a policy that is real (promoted from a repeated,
confirmed reflection — not invented ahead of time) and that genuinely has
nowhere else to live. If it fits a section of `CLAUDE.md` or a `docs/*.md`
file, put it there instead and skip this directory.

Empty for now.
