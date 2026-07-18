# Module summaries (M1–M5)

High-level overview of the architectural changes per module. Each entry lists
the **schema**, **hooks/endpoints**, **UI**, and **state transitions** touched.
File references are `path:symbol` for quick navigation.

---

## Module 1 — Invitation & application flow

**Schema.** None new. Reuses existing `users` columns (`dni`,
`food_intolerance_notes`, `name`, `surname`) and the `application_responses`
status enum.

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

**UI (`apps/web`).**
- `components/common/template-field-control.tsx` — required-field `*` marker now
  also renders on the `checkbox` kind (it was missing there; other kinds had it).
- `(auth)/claim-account/page.tsx` — added an optional **Dietary notes** textarea;
  an invited **participant** is routed to `/login?next=/my-applications`.
- `(auth)/login/page.tsx` — honours a **same-origin** `?next=` param
  (open-redirect guarded via `safeNext`), so the invited participant lands on
  the application form right after signing in.

**State transitions.** None changed; adds the name-lock guard keyed on
application status.

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

**Schema.** None new. Key fact: `users.id` is the PK; `email` is a plain
`UNIQUE` column; Better Auth's `accounts.account_id` for credential login is the
**user id as text**, and `sessions`/`accounts` FK on `user_id` — so nothing
foreign-keys on the email string.

**Endpoints / hooks.**
- `identity/outbox.ts:enqueueAuthEmail` — gained an optional
  `{ recipient, language }` override.
- `identity/routes/secondary-email.ts` — **bug fix**: secondary-email
  verification passed no `recipient`, so the email channel adapter
  (`channels/email.ts:70`, `payload.recipient ?? user.email`) fell back to the
  **primary** address. Now the new secondary address is passed as `recipient`.
- `profile.ts` `PATCH /api/users/:id/email` (`USERS_WRITE`) — safe primary-email
  change: uniqueness check vs any primary / verified-secondary, single-column
  update, marks verified (admin-vouched), audited.
- `profile.ts` `POST /api/users/:id/anonymize` (`ADMIN_ALL`) — H54 erasure the
  DELETE 409 already pointed to: scrubs every PII column in place (keeping the
  row + FK references intact) and revokes access (deletes `sessions` +
  `accounts`). `DELETE /api/users/:id` still hard-deletes fresh accounts and
  409s for accounts with history.

**State transitions.** None (identity/account lifecycle only).

---

See [background-workers.md](./background-workers.md) for which of the above run
synchronously in the request vs. are handed to a worker.
