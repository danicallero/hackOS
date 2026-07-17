# UX/UI issue agent launch guide

This guide coordinates the implementation issues created from `docs/ux-ui-audit.md`.

Tracker: [#197](https://github.com/danicallero/hackOS/issues/197)  
Execution issues: #185-#196  
Product source of truth: `plan/historias-hackos.md`

## 1. Ground rules

1. Every issue gets its own branch/worktree and one clear owner.
2. Start every worker from a commit that contains this guide and the audit.
3. Do not let domain agents recreate shared primitives owned by #185 or #186.
4. Rebase dependent work after its prerequisite merges; do not copy prerequisite code between branches.
5. Keep role logic illustrative. All access and navigation behaviour must remain capability-based.
6. Each PR references its issue and the Hxx stories it implements.
7. Each PR updates Spanish, Galician, and English together for the scope it owns.
8. Preserve the political/Ursula joke in the cookie notice.
9. An agent that discovers a missing backend state opens a small backend issue; it does not silently redesign the business rule.
10. Merge shared foundations before doing the final QA pass on dependent domain PRs.

## 2. Dependency graph

```text
Audit/guide commit
  ├─ #185 Shared visual foundation
  │    ├─ #187 Capability-based workspaces
  │    │    ├─ #192 Sponsor workspace
  │    │    ├─ #193 Programme / TV / notifications
  │    │    │    └─ #195 Event settings
  │    │    └─ #194 Statistics / privacy placement
  │    ├─ #188 Identity continuity
  │    │    └─ #189 Applications lifecycle integration
  │    ├─ #190 Queue / judging
  │    └─ #191 Offline scanners
  └─ #186 Accessible data and error states
       ├─ #189 Applications lifecycle
       ├─ #190 Queue / judging
       └─ #194 Statistics / privacy

All completed domain work
  └─ #196 Cross-platform copy and localization sweep
```

The graph expresses merge dependencies, not necessarily when an agent may begin research. A dependent agent may inspect code and prepare a plan early, but should not finalize shared-component integration before its prerequisites land.

## 3. Recommended launch waves

### Wave 1 — start immediately

Launch these simultaneously:

| Issue | Owner boundary | May run with |
| --- | --- | --- |
| #185 Shared foundation | `globals.css`, shared surface/card/header/button hierarchy, representative migrations | #186 |
| #186 Accessible data states | `DataTable`, empty/error/list primitives and their direct consumers | #185 |

These are safe in parallel only with strict file ownership:

- #185 must not redesign `DataTable` or `EmptyState`.
- #186 must not redesign `PageHeader`, `SectionCard`, or the global surface system.
- If #185 changes the base `Card` primitive, merge #185 first, then rebase #186 and run its final visual tests.

Wait before launching full implementation of #187-#195 until #185 and #186 have stable PRs or merged commits. Early research is fine.

### Checkpoint A — foundation integration

Before Wave 2:

- Merge #185.
- Rebase and merge #186.
- Run web typecheck/lint/tests once on the combined result.
- Verify light/dark, mobile/desktop, keyboard focus, table navigation, dialogs, and empty/error variants.
- Record the combined foundation commit. Every Wave 2 worktree starts from it.

### Wave 2A — critical independent domains

Launch up to four simultaneously:

| Issue | Primary files/domain | Merge wait |
| --- | --- | --- |
| #187 Capability workspaces | web sidebar/nav, mobile tab/operations entry, route grouping | Foundation only |
| #188 Identity continuity | auth, verification, claim-account, invitation, applicant return paths | Foundation only |
| #190 Queue/judging | judging and queue workspace/components | Foundation only |
| #191 Offline scanners | mobile scanner/sync UI and equivalent web logistics states | Foundation only |

Why these can run together:

- They own different route trees.
- #187 owns navigation, not domain screen content.
- #188 owns entry/return paths, not staff application review.
- #190 owns live judging, not generic DataTable or global surfaces.
- #191 owns scanner transaction feedback, not judging or application state.

Known collision points:

- #187 and #191 both touch mobile navigation. #187 owns tab/entry placement; #191 owns scanner screen content and sync feedback.
- All agents may touch i18n files. Add keys only in the existing domain section, avoid reformatting the dictionary, and rebase before final review.
- #190 may use shared error/list primitives, but must not fork them.

### Wave 2B — scoped domain work

These may be launched together once foundations are merged. If agent capacity is limited, start them after Wave 2A PRs are open.

| Issue | Can start after | Must wait to merge until |
| --- | --- | --- |
| #189 Applications lifecycle | #185 and #186 | #188 return-path contract is stable |
| #192 Sponsor workspace | #185 | #187 workspace route/IA contract is stable |
| #194 Statistics/privacy | #185 and #186 | #187 workspace placement is stable |

#189 and #188 may run simultaneously with explicit ownership:

- #188 owns signup/login/verification/claim-account and returning to an application.
- #189 owns application builder, staff review/decision/communication, confirmation state presentation, and application-domain components.
- Coordinate changes to participant application landing/detail pages through one designated owner; default owner is #189 after #188 defines the return URL contract.

#192 and #194 do not need to wait for #187 to begin domain implementation, but they should rebase on #187 before final route/navigation QA.

### Checkpoint B — multi-capability integration

After #187-#194 are available:

- Test participant + judge.
- Test sponsor representative + judge.
- Test participant + scan capability.
- Test reviewer without decision capability.
- Test decision-maker without permissions administration.
- Test admin wildcard access.
- Verify deep links and old URLs still work or redirect.
- Verify personal navigation remains stable when work capabilities change.

Do not start the final copy sweep yet.

### Wave 3 — broadcast and configuration

Run sequentially:

1. **#193 Programme, announcements, TV, and notification preferences**
   - Start after #187 is merged.
   - May overlap with late QA on #189, #190, #191, #192, or #194.
   - Owns publication/broadcast terminology used by settings.

2. **#195 Event settings and previews**
   - Start detailed implementation after #193 establishes publication/broadcast terminology and state components.
   - It may research settings structure earlier.
   - Reuse #193 concepts rather than introducing a second scheduled/public/broadcast model.

### Checkpoint C — system integration

Before #196:

- All domain PRs are merged or their terminology is frozen.
- Run web and mobile typechecks/tests.
- Verify all capability combinations affected by the work.
- Complete real-device scanner checks required by #191.
- Verify TV layouts and broadcast preview/delivery states.
- Confirm privacy eligibility and dietary-statistics policy.
- Resolve temporary or duplicate copy keys introduced during parallel work.

### Wave 4 — launch last

Launch **#196 Cross-platform anti-AI copy and localization sweep** only after Checkpoint C.

It is intentionally last because every earlier issue can add or rename state. Starting it early causes repeated i18n conflicts and encourages copy to compensate for unfinished layouts.

#196 must:

- Remove redundant descriptions after layouts are final.
- Align web/mobile state terms.
- Remove visible H-story IDs, capability keys, and internal enum language.
- Check all three locales.
- Preserve the cookie notice joke and personality.

## 4. Safe maximum concurrency

Recommended maximum: four implementation agents plus one coordinator/reviewer.

More than four agents is possible, but the single web i18n dictionary and shared component imports become a merge bottleneck. Prefer keeping extra agents on review, test design, or story-compliance analysis until a slot opens.

Suggested occupancy:

| Phase | Agents |
| --- | --- |
| Wave 1 | 2 implementation + 1 coordinator |
| Wave 2A | 4 implementation + 1 coordinator |
| Wave 2B | 3 implementation; can overlap with Wave 2A if capacity allows |
| Wave 3 | 1 primary implementation + reviewers for completed domains |
| Wave 4 | 1 copy/localization owner + domain reviewers |

## 5. Branch and worktree strategy

### Independent issue worktrees

Create each issue worktree from the latest integrated prerequisite commit, not automatically from `main` if the audit/foundation commits are not there yet.

Example after the audit commit:

```bash
git worktree add ../hackos-ux-185 -b ux/185-foundation <audit-commit>
git worktree add ../hackos-ux-186 -b ux/186-accessibility <audit-commit>
```

Example after Checkpoint A:

```bash
git worktree add ../hackos-ux-187 -b ux/187-workspaces <foundation-commit>
git worktree add ../hackos-ux-188 -b ux/188-identity <foundation-commit>
git worktree add ../hackos-ux-190 -b ux/190-judging <foundation-commit>
git worktree add ../hackos-ux-191 -b ux/191-scanners <foundation-commit>
```

If using Orca worktrees, create child worktrees from the integrated UX branch/commit because these issues intentionally depend on the audit and later foundation commits. Use independent top-level worktrees only after those commits are present on the chosen remote base.

## 6. Supervised Orca orchestration pattern

Use supervised orchestration when one coordinator will monitor completion and release dependent tasks.

Preflight:

```bash
orca status --json
orca orchestration task-list --json
orca terminal list --json
```

For each issue:

1. Create a task whose spec contains the GitHub issue URL, base commit, file ownership, expected tests, and PR target.
2. Add prerequisite task IDs through `--deps`.
3. Create/wait for the worker terminal.
4. Dispatch with `--inject`.
5. Wait for `worker_done`, `escalation`, or `decision_gate`; do not treat a timeout as failure.
6. Review and merge the prerequisite before releasing dependent tasks.

Skeleton:

```bash
orca orchestration task-create --spec "Implement #185 from <audit-commit>. Follow docs/ux-ui-audit.md and docs/ux-ui-agent-launch-guide.md. Own only the files and scope named in the issue." --json
orca terminal create --worktree <worktree-selector> --title ux-185 --command codex --json
orca terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json
orca orchestration dispatch --task <task-id> --to <handle> --inject --json
orca orchestration check --wait --types worker_done,escalation,decision_gate --timeout-ms 900000 --json
```

Create #189/#192/#194 tasks with dependency IDs even if their worktrees are prepared early. This lets the coordinator release them when their prerequisite contracts are stable.

## 7. Standard worker prompt

```text
Implement GitHub issue #<number>.

Read completely before editing:
- docs/ux-ui-audit.md
- docs/ux-ui-agent-launch-guide.md
- plan/historias-hackos.md sections referenced by the issue
- the full GitHub issue body

Base commit: <sha>
PR target: <branch>

Stay inside the issue's Agent boundary. Do not recreate primitives owned by #185/#186 and do not replace capability checks with role checks. Preserve the cookie notice political joke. Update es/gl/en together. Cover loading, empty, error, disabled, permission-denied, responsive, keyboard, and focus states relevant to this issue.

Before reporting completion:
- run the scoped typecheck/lint/tests;
- inspect the diff for unrelated changes;
- list Hxx stories covered;
- report screenshots or manual QA widths/states;
- call out any new backend issue required.
```

## 8. Merge policy

- Prefer small prerequisite PRs and merge them early.
- Do not merge a dependent PR with duplicated shared components; rebase and replace them with the merged primitive.
- Require one domain reviewer for business invariants and one UI/accessibility reviewer for P0 issues.
- Squash or merge according to repository convention, but keep the issue and Hxx references in the final commit/PR metadata.
- After every wave, update #197 and record the integrated commit used for the next wave.

## 9. What not to run simultaneously

- Do not run #196 alongside active domain redesigns.
- Do not finalize #195 before #193 terminology/state components are stable.
- Do not let #192 or #194 finalize route placement before #187.
- Do not merge #189 before the #188 application return-path contract is known.
- Do not have separate agents modify the same shared primitive in #185 and #186.
- Do not launch several agents to perform broad i18n cleanup during Waves 1-3.
- Do not use a role-switching navigation implementation in any wave.

## 10. Fastest safe plan

1. Launch #185 and #186 now.
2. Merge and verify both.
3. Launch #187, #188, #190, and #191 together.
4. As slots free, launch #189, #192, and #194; hold their final integration for the noted prerequisites.
5. Merge #187, then launch #193.
6. Merge #193, then launch #195.
7. Complete integration checkpoints and real-device QA.
8. Launch #196 last.
9. Close #197 only after cross-capability, cross-platform, and three-locale verification.
