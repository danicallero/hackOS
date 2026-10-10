-- 0703_enterprise_stand_scannable.sql — #935 staff decide which sponsor
-- stands attendees can collect in their event diary.
--
-- DELTA(#935): plan/schema-boceto.dbml has no stand concept (see 0702). A
-- sponsor without a physical stand must not appear in the attendees' stand
-- album, and a stand tag of such a sponsor must not save it. Staff with
-- `sponsors:manage` turn scanning on per enterprise; sponsor representatives
-- can still manage their tags but cannot turn scanning on.
--
-- Default: off for new enterprises, so a sponsor joins the album only by a
-- staff decision. Enterprises that already have a stand tag keep scanning,
-- which preserves their current behaviour.
ALTER TABLE enterprises
  ADD COLUMN stand_scannable boolean NOT NULL DEFAULT false;

UPDATE enterprises e
   SET stand_scannable = true
 WHERE EXISTS (SELECT 1 FROM sponsor_stand_tags t WHERE t.enterprise_id = e.id);

COMMENT ON COLUMN enterprises.stand_scannable IS '#935: attendees can collect this sponsor by scanning its stand tags. Staff-controlled.';
