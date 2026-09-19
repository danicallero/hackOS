-- 0504_wallet_update_tag_millis.sql — logistics.
--
-- DELTA(H28): wallet_passes.update_tag held two mixed formats — epoch SECONDS
-- with decimals (the 0500 column default and bumpAllAppleWalletUpdateTags)
-- and epoch MILLISECONDS (ensurePassRecord's Date.now()). The changed-serials
-- endpoint compared them as text, so Wallet's "what changed since X?" poll
-- (which both APNs pushes and pull-to-refresh funnel through) could answer
-- 204 for passes that HAD changed, and devices never refetched. Canonical
-- format is now integer epoch milliseconds; every existing tag is rewritten
-- to "now" — that costs one refetch per device and guarantees the next poll
-- compares like against like.
ALTER TABLE wallet_passes
  ALTER COLUMN update_tag SET DEFAULT ((extract(epoch FROM now()) * 1000)::bigint)::text;

UPDATE wallet_passes
   SET update_tag = ((extract(epoch FROM now()) * 1000)::bigint)::text;
