# Question-owned libraries (H11/H16/H53)

A `library` field in the dynamic application or project form owns an independent
catalogue. Its opaque `library_id` is assigned transactionally when the form is
saved. The same question editor manages the catalogue; it never appears in the
general event Libraries settings. Duplicating a question starts an independent,
empty library. Changing its label or key preserves ownership.

## Answers and proposals

Answers are arrays of catalogue names. Keeping names in saved answers allows
submitted versions to remain readable after a catalogue is retired. There is
no limit on how many values a participant may propose or select. Each name is
normalized for whitespace and bounded to 200 characters; equivalent names within
a catalogue share a case-insensitive unique index. Proposal requests lock the
catalogue row, making concurrent duplicate proposals converge on one entry.

Authenticated clients read `/api/form-libraries/:id` and propose via
`POST /api/form-libraries/:id/proposals`. Catalogue entries respect the caller's
fixture boundary. The web uses the shared multi-select with inline creation;
the native client uses a searchable checklist with an add action. Saving project
answers and submitting either form validates live catalogue selections. Historical
answers remain readable if their original library has since been removed. Retired
library questions are omitted from editable application drafts and submit-time
validation so a deleted required catalogue cannot strand an existing draft.
Stored immutable form versions remain unchanged.

## Curation

The expanded question editor shows its values, editable names, search and bulk
selection. Save values submits all edited names together. Unsaved catalogue names are
guarded when switching questions or navigating away; save the values before
saving the form definition. Selected values can be
deleted or merged into a retained value. Merge rewrites working answers and removes
duplicates; deletion removes the value from working answers. Submitted project
snapshots and submitted application responses retain the original names.

`POST /api/projects/form/libraries/:id/manage` requires project editing;
`POST /api/applications/:applicationId/libraries/:id/manage` requires application
management and verifies ownership by that application. Each batch locks the
catalogue and entries, updates answers and writes one audit entry in the same
transaction. Mutations use the existing idempotency guard. No separate global
catalogue capability or general event library configuration is introduced.

## Destructive lifecycle

Removing a saved library field, or changing its type, opens a destructive
confirmation explaining that saving will delete the entire catalogue and its
values. The subsequent form save carries the confirmed UUIDs in
`library_deletions`. The server rejects unacknowledged catalogue removal, so a
stale or alternative client cannot silently destroy it. Canceling the dialog
leaves the field intact; leaving without saving does not delete database rows.

Form saving locks the owner and synchronizes its libraries in the same transaction
as the immutable form version and audit. Removing a catalogue clears its working answer keys and deletes its child
rows through `ON DELETE CASCADE`. Deleting an application also cascades its
catalogues and values. Historical JSON form versions and submission answers are
purposeful history, not live catalogue rows. Migration `0307_field_libraries.sql`
adds the two owner/value tables; it does not seed questions or technologies.
