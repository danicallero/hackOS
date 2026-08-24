-- 0724_queue_operator_arrivals.sql — shared arrival acknowledgements for the
-- queue-operator console. This is deliberately separate from queue_history:
-- acknowledging that a team reached the waiting area is an operational note,
-- not a queue state transition.

CREATE TABLE queue_operator_arrival_ack (
  queue_entry_id integer PRIMARY KEY REFERENCES queue_entries(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_by integer REFERENCES users(id)
);

CREATE INDEX queue_operator_arrival_ack_active
  ON queue_operator_arrival_ack (acknowledged_at DESC);
