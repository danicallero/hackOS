-- H22: the person lookup must find "Pérez" when the desk types "perez".
-- Names keep their accents as stored; only the comparison strips them, via
-- the unaccent() function this extension provides (used in the logistics
-- people search's fuzzy tier).
-- DELTA(H22): no table change vs plan/schema-boceto.dbml — extension only.
CREATE EXTENSION IF NOT EXISTS unaccent;
