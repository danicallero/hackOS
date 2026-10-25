-- DELTA(#1083): public "which certificate is this file?" lookup by the SHA-256 of a
-- stored copy (GET /api/public/certificates/by-hash/:sha256). Live copies only.
CREATE INDEX attendance_certificates_pdf_sha256 ON attendance_certificates(pdf_sha256)
  WHERE pdf_sha256 IS NOT NULL;
