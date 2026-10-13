-- #994: bound idempotency_keys retention. The purge in the applications-expirer
-- tick deletes by age (see lib/idempotency.ts `purgeExpiredIdempotencyKeys`);
-- this index keeps that range scan from touching the whole table.
-- DELTA: new index only; no schema change vs plan/schema-boceto.dbml.
CREATE INDEX idempotency_keys_created_at_idx ON public.idempotency_keys (created_at);
