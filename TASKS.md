# UI Copy Audit — apps/web

Goal: eliminate redundant explanatory UI copy across the whole Next.js +
shadcn app ("interface, not documentation"). Keep copy only where it prevents
a mistake, explains a non-obvious rule/interaction, or is legally/a11y
necessary. Full rule set: `docs/DESIGN.md` §10, §15; permanent rule:
`CLAUDE.md` convention #9. Do not change business logic, API contracts, data
models, or perform unrelated refactors.

## Protocol for multiple agents

This file is the shared coordination ledger. Each numbered section below is
one **work packet** — independent enough that two agents can run it in
parallel without touching the same files. Rules:

1. **Claim before starting**: edit the packet's `Status` line to
   `in-progress`, set `Agent` to your session/agent id, set `Started` to the
   current timestamp. Commit or save that edit immediately so other agents
   see the claim — don't batch it with your content changes.
2. **Never start a packet already `in-progress`** by another agent unless its
   `Started` timestamp is stale (>2h with no `Progress notes` update) — treat
   that as abandoned/rate-limited and take it over, noting the handoff.
3. **Checkpoint as you go**: after finishing each bullet inside a packet,
   check it off (`- [x]`) and append one line to that packet's `Progress
   notes` (file(s) touched, what changed). This is what lets a resumed or
   replacement agent continue mid-packet without redoing work — never leave
   a packet's real progress only in your own head/context.
4. **If you get rate-limited or must stop mid-packet**: leave whatever
   bullets you finished checked off, leave `Status: in-progress`, and add a
   `Progress notes` line stating exactly what's done and what's left. Do not
   mark `Status: done` unless the packet's own Verification step passed.
5. **Mark `done`** only after: all bullets checked, dead locale keys removed
   (see packet 10 note), and `pnpm --filter @hackos/web typecheck && pnpm
   --filter @hackos/web lint && node scripts/check-copy.mjs` pass for your
   changes.
6. **File collisions**: packets 1–8 are route-scoped and shouldn't overlap.
   Packet 9 (shared chrome/toasts/placeholders) and packet 10 (locale files)
   touch code every other packet also touches — an agent should only take
   packet 9 or 10 after packets 1–8 are all `done`, to avoid merge
   conflicts on the same locale JSON files. Packet 11 (second pass) and
   packet 12 (final verification) run last, one agent at a time.
7. **Report back** in your own final message: packet(s) completed, files
   changed, notable before/after examples, anything flagged for manual
   design review — same as the summary format used in packet 12.

Status values: `todo` / `in-progress` / `blocked` / `done`.

---

## Packet 0 — Groundwork (done, no need to reclaim)
- Status: done
- [x] Read `apps/web/README.md`, `docs/DESIGN.md` (§10, §15), root `CLAUDE.md`
- [x] Confirmed trilingual i18n convention
      (`packages/shared/locales/{en,es,gl}/web.json`) and that
      `node scripts/check-copy.mjs` guards leaked story IDs / capability
      keys / locale sync

## Packet 1 — Auth (`(auth)/*`)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:18:30 CEST
- Progress notes:
  - Took over stale claim from previous session; login/signup remain checked and the remaining auth routes are pending.
  - `login/page.tsx` — dropped `signInDescription` ("Sign in to hackOS."),
    removed now-unused `CardDescription` import
  - `signup/page.tsx` — dropped `signUpDescription` (enumerated visible
    fields), removed now-unused import
  - `forgot-password/page.tsx` — audited success, form, error, and sign-in
    copy; retained the anti-enumeration/reset-next-step message and removed the
    redundant `rememberedIt` lead-in before the sign-in link; deleted that dead
    key from all three web locales.
  - Independent Luna review confirmed `resetEmailSent` must stay for H5
    enumeration safety and found no additional reset-page removals.
  - `reset-password/page.tsx` — audited token, password-form, validation, and
    recovery-link copy; found no redundant descriptions or helper text.
  - `claim-account/page.tsx` — audited invitation, verification, dietary-policy,
    and validation copy; retained the relationship, verification, and sensitive
    data notes, with no redundant copy to remove.
  - `verify-email/page.tsx` — audited success, resend, cooldown, error, and
    navigation copy; retained the link/resend interaction and signed-in state
    guidance, with no redundant copy to remove.
  - `applications/confirm/page.tsx` + `applications/decline/page.tsx` — audited
    loading, expiry, error, ticket/session, wallet, and released-spot copy;
    retained recovery, security, accessibility, and consequence guidance, with
    no redundant copy to remove.
  - Validation passed: `pnpm --filter @hackos/web typecheck`,
    `pnpm --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.
- [x] `login`
- [x] `signup`
- [x] `forgot-password`
- [x] `reset-password`
- [x] `claim-account`
- [x] `verify-email`
- [x] `applications/confirm`, `applications/decline`

## Packet 2 — Public (`(public)/*`)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:28:55 CEST
- Progress notes:
  - Claimed Packet 2 after Packet 1 completed; public routes and shared public/legal components are pending.
  - `app/page.tsx` delegates to the public landing; `public-page.tsx` removed the duplicate header **Log in** action while retaining the hero **Log in** and **Create account** actions.
  - `challenge/[id]/page.tsx` removed the duplicate linked-brand home control; the explicit **Back to event** escape remains for keyboard and not-found recovery.
  - `horario/page.tsx` retained the event-name orientation and navigation controls; the shared schedule timeline’s contradictory empty-state description is handled in the public-components checkpoint below.
  - `privacy/page.tsx`, `terms/page.tsx`, and their localized legal bodies were audited without changing legal text; policy summaries, update dates, and footer navigation remain.
  - `(public)/tv/*` was audited as spectator-facing display copy; countdown, room state, Wi-Fi, announcement, loading, reconnect, and screen-reader labels remain because they convey live state or how to use the display.
  - `schedule-timeline.tsx` removed contradictory `noUpcomingSchedule` helper text; `legal-page.tsx` removed the generic `legalInformation` eyebrow and duplicate **Back to home** button while keeping the linked brand and legal navigation. Deleted both dead keys from all three web locales.
  - Packet 2 verification passed: web typecheck, web lint, copy check, web tests (30 files / 240 tests), and `git diff --check`; no `legalInformation` or `noUpcomingSchedule` references remain.
- [x] `/` landing (`app/page.tsx`)
- [x] `challenge/[id]`
- [x] `horario`
- [x] `privacy`, `terms` (legal — expect most copy to stay; audit only
      redundant UI chrome around the legal text, not the text itself)
- [x] `tv` display page
- [x] `src/components/public/*`, `src/components/legal/*`

## Packet 3 — Applications workspace
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:38:20 CEST
- Progress notes:
  - Took over the stale Packet 3 claim after Packet 2 completed; the metadata-card and applications-list edits already present in this worktree are preserved while the remaining applications routes and components are audited.
  - `applications/metadata-card.tsx` + `applications/page.tsx` — dropped
    `hoursToConfirmDesc` ("Hours to confirm a spot."), restated its own
    label "Confirm window (h)"
  - `applications/page.tsx` — removed the create-modal description that
    enumerated visible fields and incorrectly promised questions on the next
    screen; deleted `newApplicationFormDesc` from all three web locales.
  - `my-applications/[id]/page.tsx` — removed the duplicate `Not available`
    wrapper heading and the self-evident `placeConfirmedDesc`; preserved the
    closed-form recovery link, ticket link, release action, and release warning.
  - `form-preview.tsx` — removed the generic `applicantsAnswerPlaceholder`
    fallback while retaining custom, file, and university-specific placeholders.
  - `review-modal.tsx` — hid the duplicate email description when the email is
    already the modal title.
  - `my-applications/page.tsx`, `application-sections.tsx`, and
    `verify-secondary-email/page.tsx` were audited with no further removals;
    status, security, validation, policy, accessibility, recovery, and next
    steps remain.
  - Packet 3 verification passed: web typecheck, web lint, copy check, web
    tests (30 files / 240 tests), `git diff --check`, and no references to the
    four removed keys remain.
- [x] `applications` (list) + `applications/[id]`
- [x] `my-applications` + `my-applications/[id]`
- [x] Application-form settings (metadata card)
- [x] `src/components/applications/*` (remaining components)
- [x] `verify-secondary-email`

## Packet 4 — Projects / Challenges / Judging / Queue
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:45:17 CEST
- Progress notes:
  - Claimed Packet 4 after Packet 3 completed; projects, challenges, judging,
   and queue surfaces are pending audit. Domain invariants remain read-only.
  - Projects routes and `src/components/projects/*` were audited with no
    high-confidence redundant copy; project/team state, permissions, recovery,
    and next-step descriptions remain.
  - Challenges retained publication/reveal, judging, sponsor-access,
    validation, recovery, and accessibility copy. Removed the duplicate
    Devpost-tags caption by keeping the SectionCard heading and giving the
    shared combobox an accessible `Devpost tags` name.
  - Queue/judging retained live state-machine, room/team, pacing, safety,
    recovery, and outcome copy. Removed the duplicate judging-window heading,
    changed the rooms section heading to the distinct `Room queues` context,
    and removed the generic create-room modal descriptor; deleted dead
    `baseRoomDetails` translations from all three web locales.
  - Packet 4 verification passed: web typecheck, web lint, copy check, web
    tests (30 files / 240 tests), and `git diff --check`.
- [x] `projects`, `projects/[id]`, `projects/import`, `projects/unmatched`,
      `my-project`
- [x] `src/components/projects/*`
- [x] `challenges`, `challenges/[id]`, `challenges/new`
- [x] `judging`
- [x] `queue`, `queue/rooms`, `queue/settings`, `queue/reviews`,
      `queue/reviews/[entryId]`, `my-queue`

## Packet 5 — Logistics
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:51:55 CEST
- Progress notes:
  - Claimed Packet 5 after Packet 4 completed; logistics, schedule, timetable,
   and wallet surfaces are pending audit. Event, wallet, and category invariants
   remain read-only.
  - Logistics routes and components retained scan, presence, stale-session,
    offline, privacy, permission, recovery, and operational state copy. Removed
    the native `title` tooltip from the activity person-search button because
    its accessible `aria-label` already provides the same name.
  - Schedule/timetable routes retained timing, category, visibility, and public
    orientation copy. Removed the redundant timetable and schedule-manager page
    descriptions and deleted both keys from all three web locales.
  - Wallet retained ticket/badge distinction, QR recovery, wallet actions,
    security/session/token guidance, accessibility names, and failure outcomes;
    no removals were warranted.
  - Packet 5 verification passed: web typecheck, web lint, copy check, web
    tests (30 files / 240 tests), and `git diff --check`.
- [x] `logistics` (hub), `logistics/accreditation`, `logistics/activities`,
      `logistics/meals`, `logistics/presence`, `logistics/stats`
- [x] `src/components/logistics/*`
- [x] `schedule`, `timetable`, `wallet`

## Packet 6 — Org / admin
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 14:58:26 CEST
- Progress notes:
  - Claimed Packet 6 after Packet 5 completed; org/admin, permissions, audit,
   announcements, and inbox surfaces are pending audit. Capability and
   notification invariants remain read-only.
- 2026-08-23 — Audited and trimmed redundant enterprise create-modal/logo/tier
  asides, user-list empty-state copy, and invitation-management descriptions;
  retained enterprise linking, logo fallback, invitation consequence, and
  access guidance because they explain non-obvious behavior.
- 2026-08-23 — Audited users list/profile and dialogs; removed the empty-list
  sentence because the visible Invite action already supplies the next step.
- 2026-08-23 — Audited permission-group list/detail/template flows; removed
  the empty-state restatement and the "change later" aside, retaining
  capability-impact, inheritance, reset, and deletion consequences.
- [x] `enterprises`, `enterprises/[id]`
- 2026-08-23 — `sponsor-faq` now uses an untitled surface for its main FAQ
  content so the page title is not repeated as an identical section heading;
  the schedule section keeps its distinct heading.
- [x] `sponsor-faq`
- [x] `users`, `users/[id]`
- [x] `permissions`, `permissions/[groupId]` — resolved flagged borderline
      copy `canChangeLaterDesc` ("You can also change these later.") on the
      role-capabilities picker
- 2026-08-23 — Audited the global audit page; retained filter examples, empty
  state orientation, and record-detail fields because they explain search
  scope or audited state rather than restating a heading.
- [x] `audit` log page
- 2026-08-23 — Audited announcements and inbox; retained delivery, targeting,
  scheduling, mandatory-channel, deletion, and empty-state guidance because
  each communicates a consequence or non-obvious live state.
- [x] `announcements`, `inbox`
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 7 — Settings
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:27:33 CEST
- Progress notes:
  - 2026-08-23 — Claimed Packet 7 after Packet 6 verification; event,
  libraries, and profile settings are pending copy audit.
- 2026-08-23 — Audited event settings; retained timing, timezone, Wallet,
  coordinate, presence-estimation, visibility, and invite-requirement copy
  because it encodes behavior or prevents configuration mistakes.
- [x] `settings/event`
- 2026-08-23 — Audited libraries; removed empty-state next-step restatements
  and the generic create-university modal description, retaining shared-scope,
  localization, applicant-proposal, and stable-ID guidance.
- [x] `settings/libraries`
- 2026-08-23 — Audited profile, email, and danger-zone settings; retained
  account-lock, secondary-email matching, removal eligibility, and destructive
  consequence copy.
- [x] `settings/profile`
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 8 — TV / display
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:30:26 CEST
- Progress notes:
- 2026-08-23 — Claimed Packet 8 after Packet 7 verification; operator control
  and spectator display surfaces are pending re-check.
- 2026-08-23 — Audited both surfaces; retained broadcast/live-state, draft
  preview, timetable precedence/rotation, auto-revert, configuration-source,
  public empty-state, and spectator Wi-Fi guidance because each explains
  behavior or a meaningful current state rather than restating a heading.
- [x] `tv/control` (app), `(public)/tv` (display) — re-check
      operator-only vs. spectator-facing copy distinctions
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 9 — Shared chrome (cross-cutting; claim only after packets 1–8 are done)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:36:00 CEST
- Progress notes:
- 2026-08-23 — Claimed Packet 9 after Packets 1–8 verification; shared
  chrome, shared feedback, and sitewide copy audit are pending.
- 2026-08-23 — Audited layout navigation, header, account/banner, and shared
  primitives; retained orientation, access, legal, and accessibility copy.
- [x] `src/components/layout/*` — nav labels, sidebar, header, breadcrumbs
- 2026-08-23 — Removed the redundant filtered-empty helper beside the visible
  clear-filters action in `DataTable` and the mobile invite-link state; changed
  the invite success toast from a long description to concise status copy.
- [x] `src/components/common/*` — empty states, toasts, confirmation
      dialogs, shared dialogs/sheets
- 2026-08-23 — Confirmed shared UI primitives inject no default descriptive
  copy; their labels, placeholders, and accessibility names remain purposeful.
- [x] `src/components/ui/*` — only if a shared primitive itself injects
      default description text (not component styling)
- 2026-08-23 — Audited sitewide toasts and placeholders; kept mutation,
  recovery, constraints, and live-state feedback, shortening the link-created
  toast to status only.
- [x] Toast copy sitewide (grep `toast(` / `toast.success` / `toast.error`)
- [x] Placeholder text sitewide (`placeholder=`)
- [x] Empty-state components sitewide
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 10 — Locale file cleanup (cross-cutting; claim only after packets 1–9 are done)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:44:00 CEST
- Progress notes:
- 2026-08-23 — Claimed Packet 10 after Packet 9 verification; full web-locale
  reference sweep is pending.
- 2026-08-23 — Removed 119 unreferenced web-locale keys across en/es/gl;
  preserved the dynamic `challengeState_*` and activity-kind registry labels.
- [x] Grep `packages/shared/locales/{en,es,gl}/web.json` for keys with zero
      remaining references and delete them across all three locales
- 2026-08-23 — Full-repo removed-key grep found zero stragglers; all three
  web locale key sets remain synchronized at 2,347 entries.
- [x] Full-repo grep for any removed key to confirm no stragglers
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 11 — Second pass (repo-wide; claim only after packets 1–10 are done)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:52:00 CEST
- Progress notes:
- 2026-08-23 — Claimed Packet 11 after Packet 10 verification; global
  description/helper-text and post-removal layout audit is pending.
- 2026-08-23 — Re-ran component-description, tooltip, and muted-helper greps;
  removed the duplicate audit-log error description and retained policy,
  recovery, accessibility, and non-obvious workflow guidance.
- [x] Re-run the `CardDescription`/`FormDescription`/`DialogDescription`/
      `SheetDescription`/`AlertDescription`/tooltip/`text-muted-foreground`
      helper-text greps against the entire app once more to catch anything
      earlier packets missed
- [x] For every removed description, check the surrounding
      Card/Dialog/Sheet/Form for now-awkward empty headers, dead spacing, or
      oversized containers; collapse/remove as needed
- [x] Remove now-unused imports file by file
- Verification passed: `pnpm --filter @hackos/web typecheck`, `pnpm
  --filter @hackos/web lint`, and `node scripts/check-copy.mjs`.

## Packet 12 — Final verification & report (last, one agent)
- Status: done
- Agent: term_f02834cc-e0d0-40ab-bcc9-a56d17de2ff7
- Started: 2026-08-23 15:56:00 CEST
- Progress notes:
- 2026-08-23 — Claimed Packet 12 after Packets 1–11 verification; final
  checks, visual spot-checks, and report are pending.
- 2026-08-23 — Final gates passed: web typecheck, web lint, copy validation,
  240 web unit tests, 8 browser smoke tests, and `git diff --check`.
- 2026-08-23 — Visual review passed for `/login` and `/tv` at 1440×900;
  `/tv` showed the intentional reconnect state because no event service is
  running locally.
- 2026-08-23 — `pnpm lint` ran copy and page checks but remains nonzero on
  pre-existing out-of-scope diagnostics: two mobile lint warnings and the
  existing `my-applications/[id]` page-size ratchet (702 lines over the 680
  line limit). A mechanical formatter fix was applied to
  `apps/api/scripts/seed-mock.ts`; no mobile or page refactor was introduced.
- [x] `pnpm --filter @hackos/web typecheck`
- [x] `pnpm --filter @hackos/web lint`
- [x] `node scripts/check-copy.mjs`
- [x] Spot-check a few changed pages visually (`/verify` or `/run` skill)
- [x] Write final summary: 37 tracked files modified plus the untracked
      `TASKS.md` ledger entry at close; removed redundant helper, header,
      empty-state, toast, and duplicate section copy; synchronized the three
      web locales at 2,346 keys; no unresolved page requires manual design
      review beyond the standard visual spot-check. The governing rule is
      root `CLAUDE.md` convention #9, cross-referencing `docs/DESIGN.md`
      §10/§15.
