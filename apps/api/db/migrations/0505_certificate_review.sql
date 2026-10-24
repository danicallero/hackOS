-- DELTA(#1083): separate the automatic and case-by-case review thresholds,
-- and retain an audited award of certified hours independently of raw scans.
ALTER TABLE certificate_settings ADD COLUMN min_review_hours numeric(5,2)
  CHECK (min_review_hours IS NULL OR min_review_hours >= 0);
ALTER TABLE certificate_settings ADD CONSTRAINT certificate_review_threshold
  CHECK (min_hours IS NULL OR min_review_hours IS NULL OR min_review_hours <= min_hours);
CREATE TABLE certificate_approvals (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  certified_hours numeric(5,2) NOT NULL CHECK (certified_hours > 0),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  approved_by integer REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER h54_active_user_user_id BEFORE INSERT OR UPDATE ON certificate_approvals
  FOR EACH ROW EXECUTE FUNCTION h54_require_active_user_reference('user_id');
COMMENT ON TABLE certificate_approvals IS '#1083 manual attendance awards: certified hours feed certificates and university exports; raw presence signals remain unchanged. Cleared on account removal (H54).';
