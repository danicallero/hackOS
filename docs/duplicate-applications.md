# Duplicate applications

Some applicants create a second account to apply twice to the same form.
Reviewers find those pairs, and either dismiss them or propose merging them;
the applicant then chooses the account to keep. No story in
`plan/historias-hackos.md` covers this yet: it extends review (H13) and uses
account removal (H54).

Code: `apps/api/src/modules/applications/duplicate-detection.ts` (scoring),
`duplicates.ts` (cases, proposal, answer), `duplicates.routes.ts`; web
`apps/web/src/app/(app)/applications/[id]/duplicates-tab.tsx` (reviewer) and
`apps/web/src/app/(auth)/applications/duplicate/page.tsx` (applicant link).

## Detection

Computed on every read of `GET /api/applications/:id/duplicates`; nothing is
stored. Every pair of responses to the form (any status, active accounts) is
scored, and a pair is suggested when at least one signal holds:

| Signal | Rule |
|---|---|
| DNI | The same national ID, from the response's `dni` answer (any key casing) or `users.dni`, compared upper case without spaces, dots or dashes (at least 6 characters). |
| Name | Sørensen–Dice similarity of character bigrams over `name + surname`, accents and punctuation removed and words sorted, ≥ 0.85. One name containing every word of the other (two words or more) counts as 0.9. |
| Email | The same similarity over the email local part before any `+tag`, letters only (dots, digits and separators removed), ≥ 0.85. Emails are always different, so the domain is ignored. |

A shared DNI ranks first, then more signals, then the higher similarity. Pairs
with an open case (dismissed, pending, kept separate) are not suggested again.

## Cases

`application_duplicate_cases` (migration `0211`) holds every decision about a
pair, keyed by `pair_key` (`"<low id>:<high id>"`); a partial unique index
allows one open case per pair.

```text
suggested ──dismiss──▶ dismissed ──undo──▶ cancelled (suggested again)
    │
    └──propose──▶ pending ──applicant: merge──────────▶ merged
                    │     ──applicant: keep separate──▶ kept_separate
                    └─────reviewer: withdraw──────────▶ cancelled
```

- **Dismiss / undo** need `applications:review`.
- **Propose / withdraw** need `applications:edit-response`: the proposal stores
  merged answers. Both responses must be `draft` or `review`; when either was
  submitted, the kept submission date (and status) must come from a submitted
  one. Each question takes the response the reviewer chose, otherwise the one
  that answered it; a file's sponsor-sharing consent follows its file.
- The proposal emails each owner (`application.duplicate`, transactional
  sender) a link valid for 14 days: `…/applications/duplicate#token=…`. Only
  the token's sha256 is stored. The email names the recipient's own address
  and the other one masked: `l•••@gmail.com` for a shared provider, and the
  domain masked too for a personal one (`m•••@f•••.com`), since
  `me@firstlast.com` identifies its owner. The H15 confirmation page uses the
  same `maskEmail`.
- A proposal stores an md5 fingerprint of both responses (answers, status,
  submission date). If either changes, the reviewer list marks it outdated and
  the applicant's answer is refused (`duplicate_merge_outdated`); withdraw it
  and propose again.
- Resolving a case clears `merged_responses`: the answers then live only on
  the kept response, and a refused merge keeps no copy. Audit rows record
  response ids and field names, never answers.

## The applicant's answer

`POST /api/applications/duplicate-merges/lookup` (read-only, rate limited)
returns the merged answers (file answers as file names, since the other
account's file is not downloadable by this link holder), the kept submission
date and both accounts — the holder's address in full, the other masked.
`POST /api/applications/duplicate-merges/decide` answers it; the first answer
from either link wins under the users → case → responses lock order, and a
second one gets `duplicate_merge_closed`.

A **merge** keeping account K:

1. Copies any file chosen from the other account to
   `uploads/<form>/<K>/<field>/merge-<case>/…` (removal deletes every upload of
   the deleted account).
2. In one transaction: refuses with `duplicate_merge_needs_staff` if the other
   account is not eligible for plain deletion (event history, H54); writes the
   merged answers, the chosen submission date and status to K's response;
   mirrors a DNI answer to `users.dni`; deletes the other response (its
   reviews included); marks the case merged.
3. Deletes the other account with `runAccountRemoval` (`source:
   "duplicate_merge"`, `requestedAction: "delete"`), which retries its own
   external cleanup on failure.

K keeps its own profile (name, shirt size, dietary data) and its reviews.

**Keep separate** closes the case and the pair is not suggested again.

## Errors

All in `packages/shared/src/error-reasons.ts` with copy in `common.json`:
`duplicate_case_exists`, `duplicate_case_closed`, `duplicate_merge_decided`,
`duplicate_merge_submission_required`, `duplicate_merge_invalid`,
`duplicate_merge_closed`, `duplicate_merge_expired`,
`duplicate_merge_outdated`, `duplicate_merge_needs_staff`.
