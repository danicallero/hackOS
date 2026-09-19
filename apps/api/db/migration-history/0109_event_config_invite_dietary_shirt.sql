-- DELTA(H10): invite-created accounts (staff, sponsors) previously never had
-- to give a shirt size and could always skip dietary restrictions. Some
-- events want sponsors and/or staff on-site for meals, so make both
-- requirements event-configurable per invited kind. Off by default —
-- matches the prior hardcoded behavior (only participants were required).

ALTER TABLE event_config
  ADD COLUMN require_sponsor_shirt_size boolean NOT NULL DEFAULT false,
  ADD COLUMN require_sponsor_dietary boolean NOT NULL DEFAULT false,
  ADD COLUMN require_staff_shirt_size boolean NOT NULL DEFAULT false,
  ADD COLUMN require_staff_dietary boolean NOT NULL DEFAULT false;
