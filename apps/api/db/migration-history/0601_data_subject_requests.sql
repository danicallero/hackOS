-- 0601_data_subject_requests.sql — staff-initiated export/deletion request
-- workflow (H54, WS-F). Not present in plan/schema-boceto.dbml at all — wholly
-- new for this issue.
--
-- DELTA(H54): a single table tracks BOTH request types ("export" and
-- "deletion") as one small state machine (pending -> processing ->
-- completed|failed), processed by a BullMQ worker (plan/07 §5). This is a
-- new workflow layered on top of the existing, unchanged
-- POST /api/users/:id/anonymize (ADMIN_ALL) direct action — the "deletion"
-- request type orchestrates that same scrubbing logic (extracted into
-- modules/identity/anonymize.ts) rather than reimplementing it.
--
-- A partial unique index prevents two simultaneously in-flight requests of
-- the same type for the same subject, mirroring queue_entries' unique-index
-- invariants rather than an application-level check.

CREATE TABLE data_subject_requests (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_user_id integer NOT NULL REFERENCES users(id),
  requested_by integer NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN ('export', 'deletion')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  reason text,
  storage_key text, -- export bundle object key; null for deletion, null until completed
  error text, -- failure detail when status = 'failed'
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER data_subject_requests_updated_at BEFORE UPDATE ON data_subject_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX data_subject_requests_subject ON data_subject_requests (subject_user_id);
CREATE INDEX data_subject_requests_status ON data_subject_requests (status);

-- At most one active (pending|processing) request per (subject, type): the
-- staff workflow must not let two requests of the same kind race each other.
CREATE UNIQUE INDEX data_subject_requests_one_active
  ON data_subject_requests (subject_user_id, type)
  WHERE status IN ('pending', 'processing');
