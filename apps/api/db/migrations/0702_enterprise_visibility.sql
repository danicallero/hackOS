-- 0701_enterprise_visibility.sql — WS-G (sponsors/content, H43-H45).
-- Enterprises get the same public-visibility model as activities and
-- challenges: an on/off flag plus an optional scheduled reveal, so sponsors
-- "se revelan a las 10" on the website and TV panels without manual buttons.

-- DELTA(H44): enterprise profile carries a description (logo, web, descripción).
ALTER TABLE enterprises ADD COLUMN description text;

-- DELTA(H45): per-enterprise reveal, independent of whether it owns a
-- published challenge. Public sponsors API filters on these.
ALTER TABLE enterprises ADD COLUMN visibility text NOT NULL DEFAULT 'hidden';
ALTER TABLE enterprises ADD CONSTRAINT enterprises_visibility_check
  CHECK (visibility IN ('visible', 'hidden'));
ALTER TABLE enterprises ADD COLUMN available_from timestamptz;

-- DELTA(H43/H46): logo display priority as a sponsorship tier for the public
-- logo grid — 1 = primary (biggest), higher numbers = smaller tiers. Falls
-- back to the enterprise's sponsor_tier logo_priority when unset.
ALTER TABLE enterprises ADD COLUMN display_priority integer;
