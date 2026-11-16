-- DELTA(#1083): the issuing organisation's tax ID (NIF) is printed next to its
-- name on every certificate. Configurable like the name; NULL omits it.
ALTER TABLE certificate_settings
  ADD COLUMN issuer_tax_id text DEFAULT 'G15659220'
    CHECK (issuer_tax_id IS NULL OR char_length(issuer_tax_id) BETWEEN 1 AND 30);
