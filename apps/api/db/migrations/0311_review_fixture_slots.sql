-- 0311_review_fixture_slots.sql — a synthetic review account may own several
-- projects, so its fixture graph needs more than one pointer row.
--
-- DELTA(H18): `review_fixture_queues` held exactly one project/challenge/queue
-- entry per fixture key. A row is now identified by (fixture_key, slot); the
-- existing rows keep slot 'main'. The shared enterprise and sponsor may be
-- referenced by every slot of one key, so the per-enterprise uniqueness goes;
-- challenge uniqueness stays (a challenge belongs to one slot). The purge
-- (identity/review-fixture-queues.ts) still verifies every pointer before it
-- deletes anything.
ALTER TABLE public.review_fixture_queues
  ADD COLUMN slot text NOT NULL DEFAULT 'main',
  ADD CONSTRAINT review_fixture_queues_slot_check CHECK (btrim(slot) <> '');
ALTER TABLE public.review_fixture_queues DROP CONSTRAINT review_fixture_queues_pkey;
ALTER TABLE public.review_fixture_queues
  ADD CONSTRAINT review_fixture_queues_pkey PRIMARY KEY (fixture_key, slot);
ALTER TABLE public.review_fixture_queues DROP CONSTRAINT review_fixture_queues_enterprise_id_key;

COMMENT ON COLUMN public.review_fixture_queues.slot IS 'H18: which of the account''s synthetic projects the pointers describe; ''main'' is the original single-project graph.';
