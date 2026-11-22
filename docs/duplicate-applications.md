# Duplicate applications

Some applicants create a second account to apply twice to the same form.
Reviewers find those pairs, and either dismiss them or propose merging them;
the applicant then chooses the account to keep. When one of the two is already
accepted, the reviewer asks instead whether to delete the other account; when
both are accepted with the same DNI, which account to keep. No story in
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

`application_duplicate_cases` (migrations `0212`, `0213`) holds every
decision about a pair, keyed by `pair_key` (`"<low id>:<high id>"`); a partial unique index
allows one open case per pair.

```text
suggested ──dismiss──▶ dismissed ──undo──▶ cancelled (suggested again)
    │
    ├──propose merge───▶ pending ──applicant: merge──────────▶ merged
    └──propose removal─▶    │     ──applicant: remove─────────▶ removed
                            │     ──applicant: keep separate──▶ kept_separate
                            └─────reviewer: withdraw──────────▶ cancelled
```

A case's `kind` is `merge` or `remove`.

- **Dismiss / undo** need `applications:review`.
- **Propose / withdraw** need `applications:edit-response`: the proposal stores
  merged answers. Both responses must be `draft` or `review`; when either was
  submitted, the kept submission date (and status) must come from a submitted
  one. Each question takes the response the reviewer chose, otherwise the one
  that answered it; a file's sponsor-sharing consent follows its file.
- **Propose removal** (`POST …/duplicates/removals`, same capability) is for a
  pair with an accepted response (`accepted`, `confirmed` or
  `accepted_internal`), which cannot be merged:
  - one accepted: it is stored as `kept_response_id` and stays untouched; the
    other account is the one offered for deletion;
  - both accepted, only with the same DNI (answer or account): no
    `kept_response_id`; the applicant chooses the account to keep.

  Anything else is `duplicate_removal_not_applicable`. The compare dialog
  offers the matching action instead of the merge, and none for two accepted
  responses without a shared DNI.
- The proposal emails each owner (`application.duplicate`;
  `application.duplicate_removal` naming the address that stays and the one
  to delete; or `application.duplicate_choice`; transactional sender) a link valid for 14 days: `…/applications/duplicate#token=…`. Only
  the token's sha256 is stored. The email names the recipient's own address
  and the other one masked — about a third of the local part and its last
  character: `anag•••2@gmail.com` for a shared provider, and the domain
  masked too for a personal one (`m•••@fir•••.com`), since
  `me@firstlast.com` identifies its owner. The H15 confirmation page uses the
  same `maskEmail`.
- A proposal stores an md5 fingerprint of both responses (answers, status,
  submission date). For a removal, the kept response only has to stay
  accepted (confirming attendance meanwhile is fine), and both when the
  applicant chooses. If either changes, the reviewer list marks it outdated and
  the applicant's answer is refused (`duplicate_merge_outdated`); withdraw it
  and propose again.
- Resolving a case clears `merged_responses`: the answers then live only on
  the kept response, and a refused merge keeps no copy. Audit rows record
  response ids and field names, never answers.

## The applicant's answer

`POST /api/applications/duplicate-merges/lookup` (read-only, rate limited)
returns the case's `kind` and both accounts — the holder's address in full,
the other masked. A merge adds the merged answers (file answers as file
names, since the other account's file is not downloadable by this link
holder) and the kept submission date; a removal adds which side stays
(`kept`) and no answers.
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

A **removal** (`decision: "remove"`, only on a removal case, with `keep` when
the applicant chooses; 400 otherwise)
runs steps 2–3 without writing anything to the accepted response: it deletes
the other response and account and marks the case `removed`. The answer is
refused as outdated if the other response changed or the kept one is no
longer accepted.

**Keep separate** closes the case and the pair is not suggested again.

## Errors

All in `packages/shared/src/error-reasons.ts` with copy in `common.json`:
`duplicate_case_exists`, `duplicate_case_closed`, `duplicate_merge_decided`,
`duplicate_merge_submission_required`, `duplicate_merge_invalid`,
`duplicate_merge_closed`, `duplicate_merge_expired`,
`duplicate_merge_outdated`, `duplicate_merge_needs_staff`,
`duplicate_removal_not_applicable`.
