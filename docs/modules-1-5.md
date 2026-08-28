# Module summaries (M1–M5)

High-level overview of the architectural changes per module. Each entry lists
the **schema**, **hooks/endpoints**, **UI**, and **state transitions** touched.
File references are `path:symbol` for quick navigation.

---

## Module 1 — Invitation & application flow

**Schema.** Reuses existing `users` columns (`dni`, `food_intolerance_notes`,
`name`, `surname`) and the `application_responses` status enum. Migration
`0108_enterprise_invite_links.sql` adds reusable enterprise links with optional
`max_redeems`, nullable `expires_at`, `revoked_at`, an atomic redemption count,
and redemption snapshots for admin tracking (H43). `0113_user_invite_links.sql`
adds the same reusable-link lifecycle for staff, sponsors, and participants,
with optional enterprise membership and deferred capability-group assignments
for staff (H10).

**Reserved form-builder keys (H11/H12).** `@hackos/shared/applications`
exports `RESERVED_FIELD_KEYS` (currently just `dni`) — the single source of
truth for which question keys are "special". A question whose key matches one
case-insensitively:
- prefills from the applicant's existing profile value when they open the
  form (`apps/web/.../my-applications/[id]/page.tsx`, `load`'s seeding block,
  same pattern as the `shirt_size`/`food_intolerances` prefill just above it);
- is mirrored back onto the matching `users` column on submit (see
  `extractDni` below).

The form builder (`apps/web/.../applications/[id]/questions-card.tsx`) surfaces
this via a "How do identifiers work?" collapsible above the question list
(same `Collapsible` pattern as the presence-policy explainer in
`settings/event/presence-tab.tsx`), and warns — but doesn't block — on save
when a reserved key isn't used by any question (`AlertModal`, skippable).
Duplicate keys (reserved or not) are always blocked at save, via the existing
`validate()` check.

To add another reserved key: add the `users` column, add an `extractX`
alongside `extractDni`, add the client-side prefill branch, then add the key
to `RESERVED_FIELD_KEYS` — see the doc comment on that constant.

**Endpoints / hooks.**
- `apps/api/src/modules/applications/service.ts:submitResponse` — on submit, in
  the same transaction that writes shirt size / intolerances to the user row, it
  now also mirrors a national-ID answer onto `users.dni` via
  `extractDni(responses)` (matches a `dni` key in any casing; `COALESCE` keeps a
  prior value when blank).
- `apps/api/src/modules/identity/routes/profile.ts` `PATCH /api/me` — blocks a
  participant from editing their own `name`/`surname` once any of their
  applications is `accepted_internal | accepted | confirmed` (409 `name_locked`).
  Staff can still fix names via `PATCH /api/users/:id`.
- `POST /api/invites/accept` already accepted `foodIntoleranceNotes` (optional);
  the onboarding form now sends it.
- `GET/POST /api/invites/enterprise-links` lets administrators list or create
  reusable enterprise account links with a redemption limit and minute-based
  expiry; `null` expiry means no automatic expiry.
- `GET/POST /api/invites/user-links` lets invitation managers create reusable
  account links for staff, sponsors, or participants. Each claimant supplies
  their own email; staff links must carry at least one capability-backed group,
  and all links support redemption limits, expiry, audit, and withdrawal via
  `POST /api/invites/user-links/:id/withdraw`.
- `GET /api/invites/enterprise-options` exposes only id/name choices to invite
  managers, without granting enterprise administration access.
- `POST /api/invites/enterprise-links/:id/withdraw` immediately disables a
  reusable link while preserving its redemption history.
- `/api/invites/lookup` and `/api/invites/accept` support reusable links. Their
  account email is supplied by the invitee, while the enterprise membership is
  created automatically. These accounts keep Better Auth's verification email
  because a shared link does not prove mailbox ownership.
- H1 keeps sign-in and read-only/preparation access available before primary
  email verification, but the shared route-policy boundary blocks event
  mutations. Application submission and spot confirmation also re-check
  `users.email_verified` in their transition transaction; the route ledger
  records explicit account/preparation exceptions and target checks for token
  confirmation.

**UI (`apps/web`).**
- `components/common/template-field-control.tsx` — required-field `*` marker now
  also renders on the `checkbox` kind (it was missing there; other kinds had it).
  Its label is also auto-linkified like `help_text`, so a required checkbox can
  carry actionable consent links (e.g. "I agree to the Terms and Privacy
  Policy") — configured per application/per language through the form builder,
  no code change needed per event.
- `(auth)/claim-account/page.tsx` — added an optional **Dietary notes** textarea;
  an invited **participant** is routed to `/login?next=/my-applications`.
- `(auth)/login/page.tsx` — honours a **same-origin** `?next=` param
  (open-redirect guarded via `safeNext`), so the invited participant lands on
  the application form right after signing in.
- `(app)/enterprises/[id]/invite-links-card.tsx` — creates copyable reusable
  links and shows their status, limit, expiry, and account redemption history;
  withdrawal uses an accessible destructive confirmation.
- `(app)/users/active-invitations-modal.tsx` and
  `(app)/users/user-invite-links-section.tsx` — unified invitation management
  for email-bound invites, enterprise links, and reusable account links,
  including link creation, usage, copy, expiry status, and withdrawal.

**State transitions.** Role is derived from relationships, never stored:
new accounts are `unassigned`; submitting a participant or mentor application
makes the illustrative role `participant` or `mentor`; an enterprise link makes
it `sponsor`; and an effective capability makes it `staff` (or `admin`).
Confirmed participants, accepted mentors, sponsor representatives, and
capability holders each receive the same permanent ticket credential, so all
attendee types can be accredited. Ticket issuance is idempotent and does not
revoke a ticket if a relationship later changes (plan/07 invariant 10).
Staff with `users:write` can manually set an attendee relationship to
participant or mentor; during accreditation, a scanner can make that same
choice for an otherwise unassigned person before assigning their badge.

Because the `tickets` row itself is permanent, a captured token (screenshot,
printout, or an already-installed Wallet pass) never expires on its own —
`identity/role.ts:hasEventAccess` is the live gate everywhere the ticket is
*served or acted on*: `GET /api/me/ticket` (H43), wallet-pass issuance/refresh
(`logistics/wallet-passes.ts`), and, at the physical door,
`logistics/accreditation.ts:checkInUser` — a ticket whose owner no longer
holds event access (declined/revoked spot, no capability/manual role/sponsor
tie) is refused with 403 even if the token itself still resolves. The
accreditation lookup card (`/api/accreditation/lookup`,
`/api/accreditation/lookup-user`) exposes `hasEventAccess` so staff see this
before attempting the badge assignment, distinct from `confirmed` (which only
reflects application status and misses capability/sponsor-only access).

**Access policy (H8, H53, H54).** Every identity, invitation, application, and
export route now declares `RouteAccessPolicy` metadata for the generated API
ledger. Invite lookup/acceptance and spot confirmation are explicit token
flows; profile/application self-service routes are authenticated; staff routes
declare their concrete capability (or the documented review/decide discovery
combination). Invitation group assignments are checked against the shared
capability catalogue while the permission-graph transaction lock is held, and
only an existing wildcard holder can defer a wildcard group through an invite.
Each token persists that wildcard authorization as durable provenance: if a
previously ordinary group later inherits `*`, acceptance fails closed unless a
wildcard holder has explicitly regenerated, renewed, or resent the invite
under the graph lock. Acceptance takes that same lock before writing
memberships, so group deletion and deferred membership grants serialize
correctly. Account deletion and
anonymization also retain at least one active effective wildcard holder; a
last-holder removal rolls back with 409. `applications:decide` can read form
metadata and decision discovery surfaces, but cannot manage forms, review, or
edit responses. Operational exports require `exports:run`; deletion requests
add `*` in a reusable pre-handler before the handler creates work. Private
application-file download and conditional export-request creation are recorded
as contextual policies (the former binds the upload key; the latter binds the
data-subject request body) rather than overstating their access as merely
authenticated or `exports:run`.

**Resettable permission templates (H8, H53).** The read-only
`GET /api/permission-groups` choice list is also available to invitation
managers so staff-invite forms can show assignable groups; group creation,
editing, nesting, and membership mutations remain `PERMISSIONS_MANAGE` only.
The permission-template
catalogue is code-owned (`identity/templates.ts`) and exposes stable keys,
client-side i18n message keys, and capability sets — never localized interface
copy or mutable role rows. `GET /api/permission-group-templates` lists the
catalogue; instantiation creates a normal editable `permission_groups` row
with nullable `template_key`, while reset restores its exact direct grants and
removes every custom include without changing its name, description, or
members. Group DTOs derive `templateDrifted` from direct-capability set equality
plus absence of includes on every read; wildcard-bearing before/after graphs
take the permission-graph advisory lock, require an existing wildcard holder,
and retain the last active holder or roll back with 409. The deprecated
`sponsor:portal` compatibility grant is deliberately absent from templates.

---

## Module 2 — Application status state machine & batch actions

**Schema.** None new; uses the existing `app_response_status` values
(`draft → review → accepted_internal|rejected_internal → accepted|rejected →
confirmed|declined|expired`).

**State transitions (new / fixed).**
- `service.ts:revokeSpot` — **new** transition `accepted | confirmed → rejected`.
  This is the "reject / decline a spot even after the participant confirmed"
  case, which had **no path** before (`decide` requires `review`;
  `revertDecision` only flips *unsent* internal decisions). It invalidates the
  confirmation token, frees the capacity slot, and notifies the applicant;
  dietary data is left on the user row (a revoked spot can be re-accepted
  later, and wiping it made that re-accept lose the data).
- Declining a `confirmed` response (self-service `doDecline`, or staff
  `revokeSpot`) also revokes event access: `identity/role.ts:hasEventAccess`
  is rechecked for the user, and if no confirmed response, manual attendee
  role, sponsor-rep membership, **or effective capability** remains,
  `logistics/wallet-passes.ts:voidTicketPasses` marks any ticket-purpose
  `wallet_passes` row `voided` and pushes the update to devices via
  `enqueueWalletSync` (the same mechanism H28 badge rotation uses). The
  `hasEventAccess` capability branch (H43) means an admin/staffer whose only
  other tie to the event was an application they later declined or had
  revoked keeps their ticket — same reasoning as sponsor reps, who already
  had an unconditional `sponsors` branch. The `tickets` row itself is never
  touched — plan/07 invariant 10 — only its exposure: `GET /api/me/ticket`
  returns `ticketToken: null` and new wallet-pass issuance 404s once
  `hasEventAccess` is false. Web nav hides wallet/queue/project/inbox for a
  "pure applicant" (`isPureApplicant` in `apps/web/src/lib/session.tsx` — no
  confirmed spot, no capability, not an enterprise judge or sponsor rep).
- Back to submitted / accept-pending-confirmation already existed
  (`revertDecision(…, "submitted")`, `decide` + `send-decision`) — verified.

**Batch (fixed "flaky" behaviour).**
- `service.ts:runBatch` — shared helper: deterministic id order, one row's
  failure never aborts the rest, and **every skip is reported** as
  `{ id, reason }`. Previously batches did `catch {}` and returned only a count,
  so partial failures were invisible.
- `batchDecide`, `batchRevertDecisions`, `batchSendDecisions` now return
  `skipped[]`; **new** `batchReAccept` and `batchRevokeSpots`.

**Endpoints.** `POST /api/responses/:id/revoke-spot`,
`POST /api/responses/batch/re-accept`, `POST /api/responses/batch/revoke-spot`
(all `APPLICATIONS_DECIDE`).

**UI.** `(app)/applications/[id]/page.tsx` — individual **Revoke spot** action
(accepted-sent / confirmed), batch **Re-accept** and **Revoke spot** buttons, and
the batch toast now surfaces the skipped count + first reason.

---

## Module 3 — User profile refactor

**Schema.** None new.

**Endpoints.** `service.ts:listUserResponsesForStaff` +
`GET /api/users/:id/applications` (`APPLICATIONS_REVIEW`) — a user's responses
with their **real** staff-side status (not the applicant mask).

**UI (`(app)/users/[id]/page.tsx`).**
- **Application** tab: was a hardcoded "module hasn't landed" placeholder; now
  lists the user's applications and links each into the review view, which
  reuses the shared `TemplateFieldControl` and enforces
  `applications:review` / `applications:edit_response` server-side. 403 → gated
  empty state.
- **Presence** tab: now the unified physical-presence view (activity passes +
  door in/out). The standalone "Check-ins" list was removed (a badge assignment
  is the first door scan).
- **Activity → "Logs"** tab: audit trail only (`AuditLogSection`).
- Admin-editable shirt size / intolerances / dietary notes already worked via
  the staff edit form (`PATCH /api/users/:id`); verified.

**Deferred (documented follow-ups).** Badge assignment auto-firing the first
presence (`time_logs` "in") row (belongs in the accreditation module, touches
H23/H24), and a badge/"Batch" assignment control on profile details
(`badge_id` is UNIQUE + history + currently system-only).

---

## Module 5 — Critical bug fixes & admin utilities

**Schema.** H54 adds `users.account_state` (`active` → `removal_pending`),
`removal_action` and `removal_started_at`, plus the separate
`anonymous_participants` audit subject. `check_in_logs` and `time_logs` retain
active-user references until the final scrub; all final direct user foreign-key
writers are guarded by the squashed `0730` active-reference triggers.
`users.id` remains the authenticated identity PK and is never used as the
anonymous identifier. Better Auth's `accounts.account_id` for
credential login is the user id as text, while `sessions`/`accounts` FK on
`user_id`.

**Endpoints / hooks.**
- `identity/outbox.ts:enqueueAuthEmail` — gained an optional
  `{ recipient, language }` override.
- `identity/routes/secondary-email.ts` — **bug fix**: secondary-email
  verification passed no `recipient`, so the email channel adapter
  (`channels/email.ts:70`, `payload.recipient ?? user.email`) fell back to the
  **primary** address. Now the new secondary address is passed as `recipient`.
- `POST /api/me/secondary-email` and the staff equivalent store the address as
  pending; Devpost membership is created only after verification. Replacing or
  deleting it (`DELETE /api/me/secondary-email`, or the `USERS_WRITE` staff
  route) transactionally revokes automatic matches that depended on it. A
  case-insensitive partial unique index plus an address-scoped transaction lock
  guarantees one verified owner under concurrent verification.
- `profile.ts` `PATCH /api/users/:id/email` (`USERS_WRITE`) — safe primary-email
  change: uniqueness check vs any primary / verified-secondary, single-column
  update, marks verified (admin-vouched), audited.
- `profile.ts` exposes the H54 self-service preflight and actions, while the
  admin routes use the same locked boundary. A fresh account is fully deleted;
  an account with canonical `check_in_logs` accreditation is irreversibly
  anonymized. Door/activity/badge history without canonical accreditation is
  reported as an integrity warning and does not silently become permanent
  retention. An open venue session is accepted as a pending-exit request;
  staff can record only the required exit before finalization. The final
  transaction creates a random UUID anonymous subject, stores verified minutes
  and application answers explicitly retained by the submitted form version,
  deletes raw accreditation/door/application/project/meal/notification and
  other identity-bearing relationships, revokes sessions/tokens/push and
  deletes the original `users` row. No mapping table or in-place anonymized
  user remains.
- `GET /api/me/removal-eligibility`, `DELETE /api/me` and
  `POST /api/me/anonymize` are authenticated and capability-free. The web and
  mobile settings pages call the preflight and present the corresponding
  destructive action directly. A self-service completion audit is actor-free
  because the actor row is deleted in the same transaction.
- `identity/removal.ts` performs two phases: commit `removal_pending` and
  revoke local access, remove provider/storage artifacts with bounded retry,
  then finalize the database transaction. The final `0730` migration adds a
  database-level active-user reference guard so stale notification, token,
  project, logistics or audit writers cannot create new FK rows after pending
  begins; only the already-open participant exit is allowed through the
  transition. It also permanently retires disconnected scanner credentials
  without a participant foreign key and prevents a response from selecting
  another form's retention snapshot.

**State transitions.** `active → removal_pending → users row deleted`, with an
anonymous participant created only for the anonymization branch. A pending
account is not eligible for authentication or event operations except that a
validated `out` scan may close its already-open venue session; finalization
then removes the identity.

---

## Module 6 — Applications review/decide IA + duplicate-rejection-email fix

**Schema.** None new; same `app_response_status` enum as Module 2.

**Bug fix — rejection email sent twice (H14).**
`service.ts:batchSendDecisions` (the row-selection "Send" action,
`POST /api/responses/batch/send-decision`) used to fall through to a resend for
any row already at `accepted`/`rejected`/`expired`, with no
`decision_sent_at` guard — unlike the toolbar's `sendDecisionsBatch`, which
does filter `decision_sent_at IS NULL`. Since the old "Communication" tab
listed unsent (`accepted_internal`/`rejected_internal`) and already-sent
(`accepted`/`rejected`) rows together, a "select all + Send" there could
re-fire a real rejection email. Fixed: `batchSendDecisions` now only ever acts
on `accepted_internal`/`rejected_internal` and skips (reports, doesn't resend)
anything else. Explicit re-sends are a separate, deliberate action: `service.ts
:resendDecision` now also handles `rejected` (folded in what used to be the
private `resendRejectedDecision`), and a new
`batchResendDecisions` / `POST /api/responses/batch/resend-decision` covers the
batch case. See the `resendDecision`/`batchSendDecisions` doc comments.

**Bug fix — could not re-accept a rejected application (H15).**
The backend transition already supported `rejected|declined|expired →
accepted` (`reAccept`/`batchReAccept`, re-checking capacity); the gap was
UI-only. The old "Confirmation" tab (where the re-accept button lived) never
listed `rejected` rows — those only appeared in "Communication", which had no
re-accept control at all. Fixed by the IA change below, which puts every final
status in one tab with all of its applicable actions.

**IA change — 4 tabs → 3 (review / outbox / sent decisions).**
`(app)/applications/workflow.ts` `WORKSPACE_STATUSES` collapsed
"Review"/"Decisions"/"Communication"/"Confirmation" into:
- **Review** (`submitted`, `review`) — scoring/notes, *and* the accept/reject
  call itself (moved here from the old "Decisions" tab, which duplicated
  Review's own row set).
- **Outbox** (`accepted_internal`, `rejected_internal`) — internal decisions
  not yet communicated: send (individual/batch/toolbar modal), revert to
  review or to the other internal decision.
- **Sent decisions** (`accepted`, `rejected`, `confirmed`, `declined`,
  `expired`) — everything already communicated, one status-filterable list
  instead of splitting `accepted`/`rejected` (old "Communication") from
  `confirmed`/`declined`/`expired` (old "Confirmation"): resend, re-accept,
  revoke spot, confirm/decline override, revert-decision all live together and
  are gated per-row by actual status instead of by which of two tabs a row
  happened to render in.

**Follow-up — status filter now scoped per tab.**
The status filter dropdown listed every `app_response_status` value
regardless of which tab was open (e.g. "Confirmed" selectable from Review).
`workflow.ts` now exports `statusesForWorkspace(workspace)`, and the dropdown
in `[id]/page.tsx` maps over that instead of the flat, unscoped
`RESPONSE_STATUSES` (removed from `../lib` — it had no other consumer).

**Bug fix — responses stuck at `submitted` with no path forward (H13).**
`submitResponse` now always lands directly on `review` (or `confirmed` if
invited) — there's no separate start-review step in the current flow — but
rows created before that change could still be sitting at `submitted`, and
`decide()` only accepted `review`, so those had **no action that could move
them anywhere**: not decidable, and the unused `startReview()` (dead code, no
route ever called it) was the only thing that could have unstuck them.
Fixed two ways: a one-time backfill migration
(`0204_backfill_stuck_submitted.sql`) folds any existing `submitted` row into
`review`; and `decide()` now treats `submitted` as an alias of `review` (belt
and suspenders, so nothing can strand there again). Removed the dead
`startReview` function.

**Endpoints.** New `POST /api/responses/batch/resend-decision`
(`APPLICATIONS_DECIDE`).

**State transitions.** `resendDecision` now also accepts `rejected` as a
starting status (previously only reachable via the removed
`resendRejectedDecision`). `decide()` now also accepts `submitted` (deprecated
alias of `review`, see above).

---

## Module 7 — Sponsor-shareable file fields & bulk export (H56)

**Schema.** None new — reuses the existing jsonb columns. A "file" template
field on `applications.template` may now carry
`shareable_with_sponsors: boolean`
(`apps/api/src/modules/applications/schemas.ts:templateFieldSchema`), the same
way `allowed_file_types`/`max_file_size_mb` already do. An applicant's consent
to share a given upload is stored as a sibling key in the response's
free-form `application_responses.responses` jsonb, next to the file's own
storage-key value:
`` `${fieldKey}__shared_with_sponsors` -> boolean `` (the convention lives in
`packages/shared/src/applications.ts:sponsorShareKey`, imported by both API and
web so the suffix never drifts). The stored file value itself is never
changed — it stays the plain string object key it always was.

**Endpoints.**
- `service.ts:validateResponses` — for a "file" field the organizer marked
  `shareable_with_sponsors`, the sibling consent key (if present) must be a
  boolean; it's optional, never `required`.
- `GET /api/applications/:id/fields/:fieldKey/files.zip?scope=all|shared`
  (`apps/api/src/modules/applications/files-export.routes.ts`, gated by
  `exports:run`) — streams a zip (via `archiver`) of every uploaded file for
  that field, one entry per applicant named `<email><ext>`. `scope=shared`
  filters to responses where the sibling consent key is `true`, and 400s if
  the field isn't marked `shareable_with_sponsors`. Each call writes an
  `audit_log` row (`application_field_export`).

**UI (`apps/web`).**
- `(app)/applications/[id]/questions-card.tsx` `FileRestrictionsEditor` — a
  "Shareable with sponsors" switch alongside the existing file-restriction
  inputs; `QuestionsCard.save()` includes it in the file-kind PATCH whitelist.
- `components/common/template-field-control.tsx` — for a "file" field marked
  shareable, renders a consent checkbox under the upload widget in
  applicant-editable contexts, or a read-only "shared/not shared" note in
  staff-only contexts.
- `components/applications/review-modal.tsx` `AnswerValue` — shows the same
  read-only consent note next to a submitted file answer.
- `(app)/applications/[id]/responses-tab.tsx` — an "Export files" menu (only
  for staff holding `exports:run`, and only when the form has at least one
  file field) offers "Export all" and, for shareable fields, "Export
  shareable only", linking straight to the zip endpoint.

**State transitions.** None — this is response metadata and a read-only bulk
export, not a status transition.

**Bug fix — 502 on export when a stored file is missing (H56).**
`getObject()` for a single row's `file_key` used to run unguarded *after*
`reply.send(archive)` had already committed headers and started streaming;
one missing/unreadable object threw, left the zip unfinalized, and hung the
connection — a reverse proxy in front of the API (Cloudflare, in the reported
incident) sees that as a broken upstream and returns 502. Fixed by
pre-flighting every `file_key` with `storage.ts:objectExists` (a `HEAD`, no
body) before committing to the streamed response at all, so failures can
still become a clean signal instead of killing the connection.

**Follow-up — failures are reported, not silently dropped.** Each unreadable
file writes an `audit_log` row (`application_response` /
`export_file_unreadable`, tied to that specific response) and the response
carries an `x-export-file-failures` header (`{ total, items: [{ responseId,
userId, email }] }`, capped at 50 items, exposed via CORS in `app.ts`).
`(app)/applications/[id]/responses-tab.tsx`'s export buttons switched from a
plain `<a href>` download (headers unreadable by JS) to a `fetch` + blob
download so they can read that header: on failure it shows a dismissible
`Alert` listing each affected applicant with a "View profile" link to
`/users/:id?tab=application`, so staff can find and manually fix the
specific application instead of the file just vanishing from the zip with no
trace.

---

## Module 8 — Reviewers can see decisions read-only (H57)

**Schema.** None — no route or capability changed; this is purely a frontend
tab-visibility change, `apps/web/src/app/(app)/applications/[id]/page.tsx`.

**UI.** The Outbox and Sent decisions tabs used to require `applications:decide`
to even appear. They now also appear for `applications:review` holders
(`canSeeDecisions = canReview || canDecide`), so a reviewer can see where every
application stands — internal decisions not yet sent, and every already-
communicated final status — without gaining any new capability. This is safe
because every actual action in that view was already gated on `canDecide`
alone, independently of tab visibility: `ResponsesTab`'s batch bar, row
selection, and "Send decisions" button, and `ReviewModal`'s Decision-controls
block for `workspace !== "review"`, all still render nothing for a
review-only caller. No backend route changed: the GET routes those tabs call
(`/api/applications/:id/responses`, `/api/responses/:responseId`) already
accepted either `applications:review` or `applications:decide`.

**State transitions.** None.

---

See [background-workers.md](./background-workers.md) for which of the above run
synchronously in the request vs. are handed to a worker.
