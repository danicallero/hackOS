# Agent Instructions

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
| `apps/api/src/modules/<domain>/` | `docs/modules-1-5.md` (M1–M5), or `docs/challenges-devpost.md` (challenges/projects), or the relevant `docs/*.md` file |
| Queue / judging / rooms | `docs/background-workers.md` (tick model, event map) |
| `apps/web/` | `apps/web/README.md` (component library, conventions) |
| `apps/mobile/` | `docs/mobile.md` (what's built), `docs/mobile-release.md` (build/release) |
| Any UI surface | `docs/DESIGN.md` (tokens, containers, accessibility, copy rules) |
| Navigation | `docs/navigation.md` (capability → workspace mapping) |
| Deployment / env vars | `deploy/README.md` + `docs/env-vars.md` |
| Capabilities or events | `packages/shared/src/capabilities.ts` and `events.ts` (never inline strings) |

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


