-- 0712_sponsor_faq.sql — WS-G (sponsors/content, H58). Singleton row of
-- sponsor-only logistics/FAQ content (venue, load-in window, merch drop-off,
-- point of contact), kept current by the organizing team so sponsor reps
-- have one place to check instead of hunting through email/Discord.
--
-- DELTA(H58): admin-authored, trilingual like challenge description/criteria
-- (content_i18n jsonb, {en,es,gl}) — not a UI-copy key, so it's data, not
-- packages/shared/locales. Singleton like event_config, read by any sponsor
-- rep (see sponsors/access.ts sponsorPortalAccessPolicy), written only by
-- SPONSORS_MANAGE.
CREATE TABLE sponsor_faq (
  id integer PRIMARY KEY, -- singleton, id = 1
  content_i18n jsonb NOT NULL DEFAULT '{"en": "", "es": "", "gl": ""}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

INSERT INTO sponsor_faq (id) VALUES (1);

CREATE TRIGGER sponsor_faq_updated_at BEFORE UPDATE ON sponsor_faq
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
