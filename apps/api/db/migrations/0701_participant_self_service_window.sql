-- DELTA(H19, H20, #852): make participant project/work-group self-service
-- timing explicit while keeping the hacking window as the default.
ALTER TABLE event_config
  ADD COLUMN participant_self_service_starts_at timestamptz,
  ADD COLUMN participant_self_service_ends_at timestamptz,
  ADD CONSTRAINT event_config_participant_self_service_window
    CHECK (
      participant_self_service_starts_at IS NULL
      OR participant_self_service_ends_at IS NULL
      OR participant_self_service_ends_at > participant_self_service_starts_at
    );
