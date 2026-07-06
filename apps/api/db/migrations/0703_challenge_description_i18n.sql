-- 0703_challenge_description_i18n.sql — WS-G (sponsors/content, H44). Extend the
-- per-language treatment from 0702 (title/criteria) to the challenge description,
-- so the whole public-facing surface can be localised. `description` stays as the
-- canonical English mirror (kept in sync with description_i18n.en).

-- DELTA(H44): optional i18n for the public-facing description.
ALTER TABLE challenges ADD COLUMN description_i18n jsonb;
