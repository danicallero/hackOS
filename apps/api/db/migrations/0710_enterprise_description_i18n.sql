-- 0710_enterprise_description_i18n.sql — per-language company description (H44).
--
-- DELTA(H44): plan/schema-boceto.dbml gives enterprises a single `description`.
-- Like challenges, the description is now edited per language (es/gl/en) in
-- `description_i18n`; `description` stays as the fallback text older clients
-- read, mirrored from the first non-empty translation (en, es, gl) on save, as
-- challenges mirror English.
ALTER TABLE enterprises ADD COLUMN description_i18n jsonb;

COMMENT ON COLUMN enterprises.description_i18n IS
  'H44: {"en","es","gl"} description; description mirrors the first non-empty one.';
