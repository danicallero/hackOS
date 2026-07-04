-- 0600_notifications.sql — announcement vigencia window (WS-F, H50-H53).
-- Source tables (notification_preferences, notification_outbox, push_tokens,
-- announcements, announcement_reads, audit_log) already exist from
-- 0001_initial.sql; this migration only adds what's missing for H50.
--
-- DELTA(H50): plan/schema-boceto.dbml / 0001 gave announcements a publish_at
-- (start of vigencia) but no end — "quedan 30 minutos de hackeo" needs to
-- disappear on its own too. Adds expires_at (nullable = no end) and
-- fanned_out_at, a bookkeeping column so the visibility publisher fans out
-- outbox notifications for a given announcement exactly once even though it
-- polls repeatedly (mirrors the "publicador de visibilidad programada" in
-- plan/07 §5.3, scoped here to announcements only).
--
-- DELTA(H52): no mail_settings table. The story says the email provider is
-- chosen "por base de datos" (Resend | SMTP | Postal); per explicit user
-- decision the provider is instead fixed at deploy time via env vars
-- (config.MAIL_PROVIDER + provider-specific keys, see src/config.ts), so
-- there is deliberately no runtime-editable mail configuration row.

ALTER TABLE announcements ADD COLUMN expires_at timestamptz;
ALTER TABLE announcements ADD COLUMN fanned_out_at timestamptz;

-- Visibility window lookups (public GET, publisher poll) filter on both ends.
CREATE INDEX announcements_publish_at ON announcements (publish_at);
