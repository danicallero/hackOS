-- 0704_company_tag_labels.sql — #935
-- DELTA(#935): company tags are worn or carried (a rep's lanyard, a table),
-- so a company may have several; an optional short staff label tells them
-- apart ("Lanyard Ana", "Table 3"). Staff-written and audited.
ALTER TABLE sponsor_stand_tags
  ADD COLUMN label text CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 40);

COMMENT ON COLUMN sponsor_stand_tags.label IS '#935: optional staff label to tell a company''s tags apart.';
