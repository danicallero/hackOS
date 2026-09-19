-- DELTA(H12): the shirt-size picker (applications, invite claim, profile
-- self-edit, staff user-edit) was a hardcoded XS-XXL list in five different
-- places. Make the event the single source of truth so an organizer can add
-- a size (e.g. XXXL) or drop one without a code change.

ALTER TABLE event_config
  ADD COLUMN shirt_sizes text[] NOT NULL DEFAULT '{XS,S,M,L,XL,XXL}';
