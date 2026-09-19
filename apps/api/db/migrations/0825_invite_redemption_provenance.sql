-- DELTA(H10, #777): retain the request origin for future reusable-link claims.
-- Historical redemptions intentionally remain NULL: their origin was never collected.

ALTER TABLE user_invite_link_redemptions
  ADD COLUMN redeemed_ip inet,
  ADD COLUMN redeemed_user_agent text;

ALTER TABLE enterprise_invite_link_redemptions
  ADD COLUMN redeemed_ip inet,
  ADD COLUMN redeemed_user_agent text;
