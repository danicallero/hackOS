-- 0701_challenge_visibility.sql — WS-G (sponsors/content). Collapse the
-- challenge lifecycle onto visibility + available_from, mirroring enterprises
-- (H45). The `status` enum (draft/active/published/archived) duplicated the
-- visible/hidden flag: status and visibility always moved together and
-- active/archived were never assigned, so the concept only added confusion.
-- Public exposure is now driven purely by visibility + available_from, exactly
-- like the sponsor reveal (sponsors/service.ts listPublicSponsors).

-- DELTA(H45): drop challenges.status. A challenge is `hidden` until an admin
-- makes it `visible`, with an optional scheduled reveal (available_from). The
-- owner edit-lock that used to trigger on status='published' now triggers on
-- visibility='visible' (see challenges/service.ts isFrozenForOwner).
ALTER TABLE challenges DROP COLUMN status;
DROP TYPE challenge_status;
