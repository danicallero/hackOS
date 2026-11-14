# Audit trail (H53)

All domain producers use `lib/audit.ts` (`audit` or `auditMany`) inside their
mutation transaction. This covers identity and permissions, applications,
projects, judging/queues, logistics/Wallet, sponsors/challenges, content,
certificates, exports and settings. Domain histories remain their operational
source of truth; this document describes the unified administrative trail.

## What an entry means

An entry identifies its action, affected entity, creation time, source and
executor. `changed_fields` records the affected field names before minimization.
Safe operational values (states, scores, flags, counts, timestamps and internal
relationship IDs) can show before/after differences. Badge IDs, email addresses and internal subject/reference IDs are retained as
operational evidence, including their previous and new values. Private subject
text, authentication secrets and attachments are replaced by a
private-value marker. No content hashes are retained. The same policy applies
to single/batched writes and API reads of historical rows.

Historical raw payloads are not rewritten by this migration. They are minimized
when read through the API. Existing account-removal/retention processes still
remove subject-bearing records; this change does not create a new permanent
content archive or infer missing historical values.

`changedFields` lets a producer name the submitted fields when its payload is a
full object or a partial configuration update. Otherwise fields are computed
from the original snapshots, ignoring object-key ordering and update timestamps.
Producers with neither snapshots nor field metadata remain explicitly without
change details: the UI must not invent what changed.

Public event content uses an entity-specific allowlist: Wallet broadcasts,
explicitly untargeted announcements, schedule descriptions/locations, challenge
content, company/form/role names, catalogue labels and certificate templates are
readable. Targeted or unknown-audience announcements, personal reviews/answers,
stand-tag labels, internal notes and credentials remain minimized. Audience and content are captured under the same announcement row lock. Public content
never exempts nested private/credential fields. A queued alert is labelled queued,
not sent. Existing minimized Wallet alerts can recover their content from the
immutable broadcast operation with the same ID; mutable current content is never
substituted for a historical snapshot.

## Who acted

- A verified request session is authoritative for a manual user action. The
  target/beneficiary ID is not evidence that the target performed it.
- Explicit `system` actions have a system executor. A known initiating user is
  kept in `initiated_by`, separate from `actor_id`; background work can pass its
  persisted requester. A scheduled action with no initiator stays system-only.
- Email/link-token actions identify a link holder, not a verified account actor.
  Wallet device registration identifies a device, not its pass beneficiary.
- Anonymous requests remain anonymous. Known automatic event/entity pairs (event-end exits, scheduled reveals, spot
  expiration, reminder dispatch and export/deletion completion) explicitly use
  System as executor and source, including legacy reads that recorded Web by
  default. Device lifecycle events remain device-originated.
- Legacy null actors with no reliable
  source are shown as unrecorded, not silently relabelled as the system.
- Intentionally identity-free events (`ip: null`, `userAgent: null`) acquire
  neither an initiator nor request correlation. Account removal scrubs subject
  references, initiator references and correlation on surviving related entries.

Actor search includes initiating users and ignores case and accents when matching
account names and email addresses. Relationships needed for subject erasure remain
internal IDs; private content is not needed to locate those relationships.

## Related actions and editing noise

Each request receives a server-generated UUID. Audit entries share that
`request_id`, including batched writes, so the detail page can open related
actions. URLs, query strings, tokens and submitted bodies are not copied into
request metadata. Historical entries have no invented request ID.

Application reviews carry a random edit-session ID. Within one reviewer,
response and session, autosaves update one entry for at most 30 minutes: the
original score stays, the final score/changed-field union/last-edit time advance.
Identical saves produce no event. A different session or reviewer stays separate.

Project draft saves, administrative judging-review updates and helper availability
autosaves and Help desk opening-window edits coalesce for the
same actor, entity, action and source while pauses remain under two minutes,
with a hard 30-minute limit. State transitions, submissions, decisions, permission
changes and separate operational actions are never coalesced by this policy.
Availability resizing explicitly records `intervals` as changed even when the
number of intervals stays the same. Identical availability saves create no event.
Opening-window edits group only while event-access policy, configured state
and current open/closed state remain unchanged; those transitions stay separate.
`last_edited_at` records updates; legacy missing edit times stay missing.

Queue history now also produces a unified audit event for operations that used
to exist only in the queue history (calling, entering, completing, no-show,
reordering and reinjection after room pause). Callers that already write a richer
unified event explicitly opt out of the default mirror, keeping one unified
event per action and preserving the existing single history/broadcast invariant.

## Reading and navigation

`GET /api/audit` and `GET /api/audit/:id` require `AUDIT_READ`. Responses include
minimized snapshots, changed fields, executor/initiator context and correlation.
`requestId` filters related events; actor filters match executor or initiator.
Rows also carry `entity_label`, the current name of catalogue subjects
(university, degree, enterprise, challenge, role, room, application, activity,
active user) resolved at read time, so the list reads "University · UDC" rather
than "University #12"; deleted subjects fall back to their id.
The list page uses the shared dense-list toolbar: a search by actor and one
Filters menu (action, entity type, specific entity, date presets or a custom
range). Each active filter is a chip that removes only itself. An entry's detail
links to `/audit?entityType=…&entityId=…`, which seeds the entity filters and
then leaves `/audit`, so removing the chip never fights the link.
The desktop table constrains column widths and truncates long changed-field summaries with an ellipsis (the full list remains in the detail) so the subject, actor and source remain visible without horizontal scrolling.
The UI localizes the current action/entity catalogue in English, Spanish and
Galician, shows recursive object differences and changed fields separately from
private values, and links supported subjects to their existing detail routes.
Application-response links choose a workspace the viewer can access and keep
the selected response through navigation/reload. The review dialog is not
modal on desktop (its file viewer and composer float beside it), so focus that
lands behind it never dismisses it; only Escape, Close or a click outside do.
Audit access alone never grants
access to the affected domain record.

## Validation

API integration tests cover single/batched correlation, legacy minimization,
private-content exclusion, actor/session/token/device/system distinctions,
autosave grouping and account deletion. Browser checks cover desktop/narrow
audit detail, related actions and application links for review/decision capability
combinations. A new event should extend the action/entity catalogue and preserve
this privacy boundary; private review/answer content remains excluded. Operational identifier histories
are covered by account erasure, including historical email addresses; identifiers
that were already replaced by a private-value marker are not guessed from current data.
