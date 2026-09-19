-- DELTA(H11): group template fields into named sections (title + description,
-- i18n) for a more readable builder/applicant form. Fields opt in via
-- `section_key`; ungrouped fields keep rendering exactly as before.

ALTER TABLE applications
  ADD COLUMN sections jsonb NOT NULL DEFAULT '[]';
