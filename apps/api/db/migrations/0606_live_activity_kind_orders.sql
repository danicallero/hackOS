-- DELTA(H38, H25, H59, H19, H22): per-user Live Activity kind order (#966).
--
-- plan/schema-boceto.dbml has no Live Activity model (see 0604). Organizers
-- set the default kind priority (`live_activity_kind_settings.priority`);
-- this table records a user's own order, which decides which kinds win a
-- device's `max_concurrent` slots for that user. Like the opt-outs (0605) it
-- is per user, so it follows the account to every install. Only a customized
-- order is stored: an absent row means the organizer default, so resetting
-- deletes the row and later organizer reorders apply again.
CREATE TABLE live_activity_kind_orders (
  user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Highest priority first; kinds not listed follow in the organizer order.
  kinds text[] NOT NULL
    CHECK (
      cardinality(kinds) BETWEEN 1 AND 5
      AND kinds <@ ARRAY['queue', 'activity', 'attendee_activity', 'deadline', 'accreditation']
    ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER live_activity_kind_orders_updated_at BEFORE UPDATE ON live_activity_kind_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
