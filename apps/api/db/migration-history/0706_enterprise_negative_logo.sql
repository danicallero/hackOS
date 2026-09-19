-- Optional logo intended for dark/black backgrounds. Reads coalesce this to
-- logo_url so existing enterprises always expose both variants.
ALTER TABLE enterprises ADD COLUMN logo_negative_url text;
