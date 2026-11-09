-- DELTA(H53): private change metadata and server-owned request correlation.
ALTER TABLE audit_log
  ADD COLUMN changed_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN request_id uuid;
CREATE INDEX audit_log_request ON audit_log (request_id, id) WHERE request_id IS NOT NULL;
COMMENT ON COLUMN audit_log.changed_fields IS 'Changed field names; never private values or content hashes.';
COMMENT ON COLUMN audit_log.request_id IS 'Server-generated request correlation; absent for intentionally identity-free events.';
ALTER TABLE audit_log
  ADD COLUMN actor_kind text NOT NULL DEFAULT 'unknown'
    CHECK (actor_kind IN ('user', 'system', 'token', 'device', 'anonymous', 'unknown')),
  ADD COLUMN initiated_by integer REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_log ADD COLUMN last_edited_at timestamptz;
CREATE INDEX audit_log_edit_session ON audit_log (entity_type, entity_id, actor_id, action, id DESC)
  WHERE action IN ('save_draft', 'review.update', 'review_scored');
