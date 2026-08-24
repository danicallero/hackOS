-- 0722_announcements_audience_and_recipients.sql — notification-creation
-- revamp (H50).
--
-- DELTA(H50): 0602 dropped announcements.target_role — "an organiser
-- explicitly chooses whether to notify everyone through each recipient's
-- enabled channels." This reintroduces audience targeting, but as an
-- additive opt-in (empty audiences = everyone, default unchanged) using the
-- same sponsor/participant/mentor vocabulary schedule already uses (H59),
-- plus a new explicit-recipient-list mode that didn't exist before —
-- mutually exclusive with audiences, enforced at the API layer since
-- checking a join table's cardinality isn't practical via CHECK.
--
-- Also closes a gap 0602 left open: a notify-only announcement
-- (screen_placement = 'none' AND notify_users = true) has no meaningful
-- visibility window — it fires once at publish_at (H51's "aparece y
-- desaparece solo" only applies to what's shown on a screen), so expires_at
-- is now disallowed for that specific combination. A screen_placement =
-- 'none' row that ISN'T a notification (notify_users = false, e.g. a plain
-- content-feed item with no screen and no delivery) keeps using expires_at
-- as an ordinary visibility window, same as before — this only tightens the
-- notify-only case. Screen-placed rows (embedded/fullscreen) keep the
-- window exactly as before regardless of notify_users.
--
-- Channels: staff now picks a per-announcement candidate set instead of
-- always sending all three; delivery still runs each recipient through
-- their own H51 preferences (resolveChannels is untouched). Stored as
-- text[] rather than notification_channel[] — node-postgres has no array
-- parser for custom enum OIDs (only text[] and other builtins parse to a JS
-- array out of the box), and application-layer Zod validation already
-- constrains the values, matching how `audiences` above is also plain
-- text[] rather than an enum array.

ALTER TABLE announcements
  ADD COLUMN audiences text[] NOT NULL DEFAULT '{}',
  ADD COLUMN channels text[] NOT NULL DEFAULT '{in_app,email,push}',
  ADD CONSTRAINT announcements_channels_valid
    CHECK (channels <@ ARRAY['in_app', 'email', 'push']::text[] AND array_length(channels, 1) > 0),
  ADD CONSTRAINT announcements_no_expiry_when_notify_only
    CHECK (
      screen_placement <> 'none' OR notify_users = FALSE OR expires_at IS NULL
    ) NOT VALID;

CREATE TABLE announcement_recipients (
  announcement_id integer NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (announcement_id, user_id)
);
