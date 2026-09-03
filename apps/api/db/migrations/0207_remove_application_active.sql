-- DELTA(H11): `active` was a second, independent "is this form open" gate
-- alongside open_at/close_at, which let a form be effectively closed two
-- different ways with two different UI controls. Window state now derives
-- purely from open_at/close_at (isWindowOpen); an admin who wants a form
-- closed sets close_at instead of toggling a separate flag.

ALTER TABLE applications
  DROP COLUMN active;
