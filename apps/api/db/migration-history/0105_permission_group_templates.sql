-- 0105_permission_group_templates.sql — DELTA(H8, H53): an opt-in template
-- origin is retained on ordinary, editable permission groups. The catalogue
-- itself lives in application code so its capability sets remain tied to the
-- shared constants rather than copied into mutable database rows.

ALTER TABLE permission_groups
  ADD COLUMN template_key text;

CREATE INDEX permission_groups_template_key_idx
  ON permission_groups (template_key)
  WHERE template_key IS NOT NULL;

COMMENT ON COLUMN permission_groups.template_key IS
  'H8 template catalogue key used to calculate template drift; does not restrict normal group editing.';
