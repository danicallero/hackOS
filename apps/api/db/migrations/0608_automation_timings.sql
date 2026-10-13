-- DELTA(H19, H20, H22, H45, H51, H52, #966): organizer-set timings for every
-- automatic notification and Live Activity.
--
-- plan/schema-boceto.dbml models neither. Besides the schedule lead (0607),
-- the deadline and accreditation Live Activity windows were deployment
-- variables or constants, and the schedule-item reminder push was a fixed
-- 15 minutes that could not be switched off. Only intentional overrides are
-- stored (R018): a NULL timing means "use the deployment default" (the env
-- value, or the built-in constant), and resetting stores NULL again.
ALTER TABLE live_activity_settings
  ADD COLUMN deadline_lead_minutes integer CHECK (deadline_lead_minutes BETWEEN 15 AND 1440),
  ADD COLUMN deadline_closing_minutes integer CHECK (deadline_closing_minutes BETWEEN 1 AND 240),
  ADD COLUMN accreditation_lead_minutes integer CHECK (accreditation_lead_minutes BETWEEN 0 AND 1440),
  ADD COLUMN accreditation_tail_minutes integer CHECK (accreditation_tail_minutes BETWEEN 0 AND 1440);

-- Singleton for the automatic notification jobs. `schedule_reminders_enabled`
-- is the organizer switch for the schedule-item reminder job (users' own
-- opt-ins stay in notification_preferences); the lead is a nullable override
-- of the built-in 15 minutes.
CREATE TABLE notification_automation_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  schedule_reminders_enabled boolean NOT NULL DEFAULT true,
  schedule_reminder_lead_minutes integer
    CHECK (schedule_reminder_lead_minutes BETWEEN 1 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notification_automation_settings_updated_at
  BEFORE UPDATE ON notification_automation_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO notification_automation_settings (id) VALUES (1);
