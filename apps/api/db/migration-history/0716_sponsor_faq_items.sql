-- 0714_sponsor_faq_items.sql — WS-G (sponsors/content, revises H58).
-- H58 originally shipped as a single free-text trilingual blob, but that
-- isn't what was asked for: a real FAQ (question/answer pairs, collapsible)
-- plus separate admin-authored text blocks (e.g. "logistics info"). Replaces
-- the single `content_i18n` blob with an ordered `items` array — same
-- architecture as `challenges.prizes`/`challenges.judging_panel_criteria`
-- (an admin-edited jsonb array, replaced wholesale on save), not a
-- per-item CRUD table.
--
-- DELTA(H58): each item is `{ kind: 'qa'|'text', heading: I18nText, body: I18nText }`
-- — `heading` is the question for `kind='qa'` or the block title for
-- `kind='text'`; `body` is the answer or the block text. No feature has
-- shipped against the old `content_i18n` column yet, so this drops it
-- outright rather than migrating data.
ALTER TABLE sponsor_faq
  DROP COLUMN content_i18n,
  ADD COLUMN items jsonb NOT NULL DEFAULT '[]'::jsonb;
