-- 0702_challenge_i18n.sql — WS-G (sponsors/content, H44). The public-facing
-- challenge title and criteria can carry per-language text (en/es/gl), so the
-- public catalogue can read in the visitor's language like the judging panel.
-- `title`/`criteria` stay as the canonical English mirror (title is kept in
-- sync with title_i18n.en) so every existing consumer — queue, projects,
-- exports — keeps working unchanged.

-- DELTA(H44): optional i18n for the public-facing title and criteria.
ALTER TABLE challenges
  ADD COLUMN title_i18n jsonb,
  ADD COLUMN criteria_i18n jsonb;
