-- DELTA(H54): short-lived scanner tombstones prevent a disconnected staff
-- device from accepting a badge that was anonymized while it was offline.
-- There is deliberately no user_id or anonymous_participant_id: this is a
-- revocation set, not an identity mapping. Housekeeping removes it after the
-- event's operational window.
CREATE TABLE IF NOT EXISTS scanner_revoked_badges (
  badge_id text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS scanner_revoked_badges_expiry ON scanner_revoked_badges (expires_at);

CREATE TABLE IF NOT EXISTS scanner_revoked_tickets (
  ticket_token text PRIMARY KEY,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS scanner_revoked_tickets_expiry ON scanner_revoked_tickets (expires_at);
