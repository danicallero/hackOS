-- DELTA(H28): record the Google Wallet resource type so legacy Generic
-- objects can be expired through the right API endpoint while new entrance
-- tickets use EventTicketObject.
ALTER TABLE wallet_passes
  ADD COLUMN google_object_type text;

-- Before this migration every Google pass was issued as a GenericObject.
UPDATE wallet_passes
   SET google_object_type = 'generic'
 WHERE platform = 'google'
   AND google_object_id IS NOT NULL;

ALTER TABLE wallet_passes
  ADD CONSTRAINT wallet_passes_google_object_type_check
  CHECK (google_object_type IS NULL OR google_object_type IN ('generic', 'event_ticket'));

COMMENT ON COLUMN wallet_passes.google_object_type IS
  'H28: Google Wallet resource type. Existing GenericObject rows are retained as legacy; new tickets use event_ticket and badges use generic.';
