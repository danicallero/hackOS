-- 0702_sponsor_stand_tags.sql — #935 sponsor stands that attendees scan into
-- their event diary.
--
-- DELTA(#935): plan/schema-boceto.dbml has no stand or booth concept. A stand
-- is identified by one or more physical NFC tags (the 7-byte NTAG213 UID as
-- uppercase hex, the same encoding as badges, docs/mobile.md) and/or a
-- printable QR token. Codes are globally unique so a scan resolves to exactly
-- one stand; badge assignment refuses a stand code and vice versa.
CREATE TABLE sponsor_stand_tags (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  enterprise_id integer NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('nfc', 'qr')),
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsor_stand_tags_code_format CHECK (
    (kind = 'nfc' AND code ~ '^[0-9A-F]{14}$')
    OR (kind = 'qr' AND code ~ '^STAND-[0-9A-Z]{16}$')
  )
);

CREATE INDEX sponsor_stand_tags_enterprise ON sponsor_stand_tags (enterprise_id);

COMMENT ON TABLE sponsor_stand_tags IS '#935: NFC tag UIDs and printable QR tokens that identify an enterprise''s stand for the event diary.';
