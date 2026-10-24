# Attendance certificates

Certificates (#1083) are issued by the organisation, not by a person. There is
no handwritten or personal digital signature and no electronic seal (the
association does not issue one). Trust comes from the issuer named on the PDF
plus an unguessable code that a public page resolves. Anything that needs a
real signature is requested and signed by email, outside hackOS; staff can
download the PDF of any certificate (`GET /api/certificates/:id/pdf`).

Code: `apps/api/src/modules/certificates/` (`service.ts` policy and issue,
`pdf.ts` rendering, `routes.ts`). Migrations:
`0503_attendance_certificates.sql`, `0504_certificate_languages.sql`,
`0505_certificate_review.sql`.

## Policy

Configure **Event settings → Certificates** (`/settings/event?tab=certificates`):
set the automatic minimum and a lower review minimum, optionally require
a project presentation for automatic issue, and set the issuer. One Save applies the whole policy.

One row in `certificate_settings`, edited with `PUT /api/certificates/settings`
(`presence:manage`, audited). Concurrent policy edits lock the singleton row
before merging changes, so unrelated patches preserve each other:

| Setting | Meaning |
|---|---|
| `minHours` | Secured venue hours (H24 `guaranteedPresenceMs`; open provisional time does not count) needed for automatic issue. `null` turns automatic issue off. |
| `minReviewHours` | Lower secured-hours threshold that opens case-by-case review. `null` disables the review queue; cannot exceed `minHours` when both are set. |
| `requiresDemo` | Only people whose team started or finished a presentation in the queue (`queue_entries.presentation_started_at` / `completed_at`). |
| `issuerName` | The organisation printed on the document. |

A person who does not meet the policy gets nothing, with a reason
(`certificate_hours_not_met`, `certificate_demo_required`,
`certificate_not_available`). Reaching the lower threshold without qualifying
automatically returns `certificate_review_required`; no certificate is issued
until staff approve. Lowering the review threshold alone never awards hours.

## Case-by-case review

**Attendance → Certificates** (`/logistics/presence?tab=certificates`,
`presence:manage`) lists pending reviews, eligible/approved people, actual
attendees and the complete event-access roster. Filter by university, open a
person, and inspect the existing presence timeline: all door signals and all
scanned activities, including meals, late-night activities and invalid or
provisional windows. A missed meal is evidence to assess, not an automatic
rejection. The same award controls are available in the person's Attendance tab.

`POST /api/users/:id/certificate-approval` requires explicit positive
`certifiedHours` and a review `reason`. It records the award, reviewer and time
in `certificate_approvals`, without changing any raw time/activity log. An award
can intentionally differ from measured time (for example 12 measured hours,
30 certified hours). The person can then self-serve every variant/language,
even while automatic issue is disabled. Staff can also award and issue in one
transaction with `POST /api/certificates` and both `certifiedHours` and
`overrideReason`; a reason alone is insufficient.

Approval, issuance and account removal serialize on the person. A changed
award revokes all live documents carrying a different award (including earlier
automatic documents); the person obtains a new code on their next request.
Reapproving unchanged hours preserves documents already carrying that manual
award. Each approval and resulting revocation is audited.

Presence settings (`/settings/event?tab=presence`) and the review roster both
expose the existing **Presence and attendance register** (`logistics:stats`)
and **Activity attendance** (`exports:run`) panels. The individual review also
provides a detailed attendance-evidence CSV for that person (`logistics:stats`).
These raw exports keep their original semantics; they do not substitute the
manual award for measured or provisional presence. Presence settings links
directly to the review queue.

## University exports

The review roster offers **Attendance CSV** and **UDC CSV**; exports require
`logistics:stats`, are audited and never cached. Both apply the selected
university server side (`universityId`) across all review states, independently
of the roster's status filter. They include people with secured attendance or
an explicit manual award; accounts with neither are omitted.

`GET /api/certificates/participants/export.csv?format=general` includes identity,
university, `measured_hours`, `certified_hours` and status. Pending reviews have
no certified hours. The original presence reduced/full exports remain raw
attendance reports, so evidence never gets overwritten by an award.

`format=udc` includes only automatically eligible or manually approved people.
It follows the supplied `Modelo_Rexistro_Actividades.xlsx`: Nome Asociación,
Nome e apelidos, DNI, Nome da actividade, Data da actividade, Lugar de realización,
Nº de horas realizadas, Observacións. One row covers the complete event and its
dates, as in the template's Marzo example; hours are numeric and use the manual
award when present. Thus an approved 30-hour award is 30 on both the certificate
and university CSV, while the general CSV still exposes the measured time.

## Variants

The participant picks one when requesting; each is a separate certificate.

- `participation`: took part and completed the program from the event start to
  its end date.
- `hours`: the same plus the certified hours at issue time.
- `activities`: lists every non-meal activity with a scan record
  (`activity_logs`).

All manually awarded variants explicitly state the awarded hours, including
participation and activities certificates.

Languages: es, gl and en. Requesting another language creates a separate
certificate and verification code; same-language retries return the existing one.
The text is fixed per language in `pdf.ts`. The
GPUL logo is `apps/api/assets/certificate/logo.png` (rasterised from the
organisation's `default.svg`); it is drawn top right (the Docker image already copies `assets/`). The PDF
uses the standard Helvetica fonts, which viewers substitute rather than embed.

## Document and verification

The PDF is rendered on demand from `attendance_certificates.snapshot` (name,
event, dates, venue, issuer, hours, activities as issued). The DNI/NIE is the
exception: it is read live from `users.dni`, printed only when the account has
one, and never stored on the certificate. The JSON verification never returns it;
the official PDF does, on purpose: the owner shares the document (or its CSV) with
administrations, and `/verify/{code}` is the viewer they use to check it is the
real one.

Downloads from the participant portal are *copies*: every page gets the footer
from `lib/pdf-copy-footer.ts` (QR, "Copy of the document - issuer", print date,
page n of N, `CSV: <code>` and how to validate), the way the Spanish
administration marks electronic copies. The QR and code point to
`{WEB_URL}/verify/{code}` (`https://os.hackudc.com` in deploy, derived from
`WEB_DOMAIN`); `GET /api/public/certificates/:code` (and `/pdf`, 60 requests a minute per address,
then 429) returns valid or revoked,
the name, event, dates and, for the hours variant or any manually awarded document, the certified hours. The body of
the PDF reserves `COPY_FOOTER_RESERVE` points at the bottom for it. Any new
participant-facing PDF should be stamped with `stampCopyFooter` the same way.

## Web

`/verify/{code}` shows only the official PDF (no text, hackOS branding in the
header) and is never indexed: `noindex` metadata and `X-Robots-Tag` on the page
(`next.config.ts`), `X-Robots-Tag` on every API response, no Referer.

Participants with event access get a Certificates section in My profile: pick a
variant and language, get the certificate, download it. Staff with `presence:manage` get
the same panel for a person in their profile's Attendance tab, plus override
reason, revoke, download without CSV and download copy.
Mobile screens are not built yet.

## Lifecycle

- One live certificate per person, variant and language: asking again returns it
  (concurrent requests converge on the unique index).
- Staff issue one (`POST /api/certificates`), issue to everyone eligible
  (`POST /api/certificates/bulk`, idempotent) or revoke with a reason
  (`POST /api/certificates/:id/revoke`). A revoked certificate verifies as
  revoked with no personal data and its PDF answers 409.
- Account removal (H54) revokes the person's certificates and clears their
  snapshot and deletes the manual award (`identity/removal.ts`).
- Issue, revoke and settings changes are audited (H53):
  `certificate.issue`, `certificate.approve`, `certificate.revoke`,
  `certificate_settings.update` and university `export` actions.
