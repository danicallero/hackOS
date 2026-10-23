# Attendance certificates

Certificates (#1083) are issued by the organisation, not by a person. There is
no handwritten or personal digital signature and no electronic seal (the
association does not issue one). Trust comes from the issuer named on the PDF
plus an unguessable code that a public page resolves. Anything that needs a
real signature is requested and signed by hand outside hackOS; staff download
the PDF of any certificate for that (`GET /api/certificates/:id/pdf`).

Code: `apps/api/src/modules/certificates/` (`service.ts` policy and issue,
`pdf.ts` rendering, `routes.ts`). Migration: `0503_attendance_certificates.sql`.

## Policy

One row in `certificate_settings`, edited with `PUT /api/certificates/settings`
(`presence:manage`, audited):

| Setting | Meaning |
|---|---|
| `minHours` | Verified venue hours (H24 `userHours`) needed for automatic issue. `null` turns automatic issue off. |
| `requiresDemo` | Only people whose team started or finished a presentation in the queue (`queue_entries.presentation_started_at` / `completed_at`). |
| `issuerName` | The organisation printed on the document. |

A person who does not meet the policy gets nothing, with a reason
(`certificate_hours_not_met`, `certificate_demo_required`,
`certificate_not_available`). Staff can override per person:
`POST /api/certificates` below the policy needs `overrideReason`, stored on the
certificate and in the audit log.

## Variants

The participant picks one when requesting; each is a separate certificate.

- `participation`: took part and completed the program from the event start to
  its end date.
- `hours`: the same plus the verified venue hours at issue time.
- `activities`: lists every non-meal activity with a scan record
  (`activity_logs`).

Languages: es, gl and en. The text is fixed per language in `pdf.ts`. The
GPUL logo is `apps/api/assets/certificate/logo.png` (rasterised from the
organisation's `default.svg`); it is drawn top right (the Docker image already copies `assets/`). The PDF
uses the standard Helvetica fonts, which viewers substitute rather than embed.

## Document and verification

The PDF is rendered on demand from `attendance_certificates.snapshot` (name,
event, dates, venue, issuer, hours, activities as issued). The DNI/NIE is the
exception: it is read live from `users.dni`, printed only when the account has
one, and never stored on the certificate or shown by verification. Each
certificate has a QR and a code pointing to `{WEB_URL}/verify/{code}` (`https://os.hackudc.com` in deploy, derived from `WEB_DOMAIN`);
`GET /api/public/certificates/:code` returns valid or revoked, the name, event,
dates and, for the hours variant only, the hours.

## Lifecycle

- One live certificate per person and variant: asking again returns it
  (concurrent requests converge on the unique index).
- Staff issue one (`POST /api/certificates`), issue to everyone eligible
  (`POST /api/certificates/bulk`, idempotent) or revoke with a reason
  (`POST /api/certificates/:id/revoke`). A revoked certificate verifies as
  revoked with no personal data and its PDF answers 409.
- Account removal (H54) revokes the person's certificates and clears their
  snapshot (`identity/removal.ts`).
- Issue, revoke and settings changes are audited (H53):
  `certificate.issue`, `certificate.revoke`, `certificate_settings.update`.
