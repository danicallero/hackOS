-- DELTA(H59): who an RSVP is asked of is chosen among roles (the publicly
-- visible ones in the editor) instead of the four attendance kinds. A person is
-- asked, and counted, when they hold at least one of `role_ids`; the legacy
-- `kinds` keep working for rows that still carry them (older clients).
ALTER TABLE public.activity_rsvp_settings
  ADD COLUMN role_ids integer[] NOT NULL DEFAULT '{}';

-- Existing settings move to the seeded roles each kind stood for, and their
-- kinds are cleared so the roles are the single source.
UPDATE public.activity_rsvp_settings st
   SET role_ids = COALESCE((
         SELECT array_agg(DISTINCT r.id ORDER BY r.id)
           FROM public.roles r
          WHERE r.deleted_at IS NULL AND r.is_seeded
            AND ((r.name = 'Participant' AND 'participant' = ANY(st.kinds))
              OR (r.name = 'Mentor' AND 'mentor' = ANY(st.kinds))
              OR (r.name = 'Sponsor' AND 'sponsor' = ANY(st.kinds))
              OR (r.event_access AND r.name NOT IN ('Participant', 'Mentor', 'Sponsor')
                  AND 'staff' = ANY(st.kinds)))
       ), '{}'),
       kinds = '{}'
 WHERE cardinality(st.kinds) > 0;

COMMENT ON COLUMN public.activity_rsvp_settings.role_ids IS 'H59: roles an RSVP is asked of; holding any of them is enough. Ids are checked in the API (existing, publicly visible roles).';
