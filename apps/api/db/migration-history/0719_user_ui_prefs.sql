-- 0717_user_ui_prefs.sql — WS-A1 (identity). Generic per-account UI
-- preference store, namespaced by view (e.g. `scheduleTable`) — starts with
-- the schedule management table's column visibility/order (H59), but the
-- shape is deliberately generic so other views can add their own key without
-- another migration. Synced from the browser so a preference set on one
-- device follows the account to another, with localStorage as the fast/
-- offline-tolerant local cache.
ALTER TABLE users ADD COLUMN ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
