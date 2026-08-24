# Summary

<!-- Briefly describe what this PR does. Keep it to 1–3 sentences. -->

**Story:** <!-- Hxx, e.g. H29, H30 -->

## What changed?

<!-- Describe the concrete changes introduced by this PR. -->

*
*
*

## Why did it change?

<!-- Explain the problem, requirement, bug, or motivation behind the change. Link the relevant issue if applicable. -->

## How did it change?

<!-- Implementation approach and decisions that aren't obvious from the diff. -->

## How was it tested?

* [ ] Integration tests (`pnpm --filter @hackos/api test`)
* [ ] Web unit tests / typecheck (`pnpm --filter @hackos/web test` / `typecheck`)
* [ ] Manual testing
* [ ] N/A — explain why

**Test scenarios:**

1.
2.

## Screenshots

<!-- Required if this PR changes what a web/mobile/TV screen looks like — see docs/ui-testing.md § Screenshots on UI PRs.
     Delete this section if there's no UI change. -->

## Migration

<!-- Delete this section if this PR has no DB migration.
     File under apps/api/db/migrations/NNNN_name.sql, correct numbering band, DELTA(Hxx) comment vs plan/schema-boceto.dbml. -->

## Risk / impact

**Risk level:** Low / Medium / High

**What could break?** <!-- Which users, services, APIs, jobs, or data could be affected? -->

**Known limitations / edge cases:**

*

## Rollback strategy

**Rollback trigger:** <!-- What would make us decide to roll back? -->

**Rollback steps:**

1.
2.

**Data considerations:** <!-- Backward compatible? Can migrations/data changes be reversed? -->

## Reviewer notes

**Please pay particular attention to:**

*

## Pre-merge checklist

* [ ] Commit/PR message references the story (`Hxx`)
* [ ] Tests added or updated where appropriate
* [ ] Docs updated in this same PR (see CLAUDE.md § Documentation table)
* [ ] Trilingual copy (`es`/`gl`/`en`) added for any new UI strings
* [ ] No unnecessary/debug code remains
* [ ] Security/privacy implications considered
* [ ] Rollback strategy is clear
