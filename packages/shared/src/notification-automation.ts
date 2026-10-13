/**
 * Organizer settings for the automatic notification jobs (H50-H52, H45).
 * Users' own opt-ins (`notification_preferences`) stay separate: this is the
 * event-level switch and timing.
 */

/** Minutes before a schedule item starts that its reminder is sent (default). */
export const SCHEDULE_REMINDER_LEAD_MINUTES_DEFAULT = 15;
export const SCHEDULE_REMINDER_LEAD_MINUTES_MIN = 1;
export const SCHEDULE_REMINDER_LEAD_MINUTES_MAX = 1440;

export interface NotificationAutomationSettings {
  /** Master switch of the schedule-item reminder job. */
  scheduleRemindersEnabled: boolean;
  /** The override when `scheduleReminderLeadCustom`, else the default. */
  scheduleReminderLeadMinutes: number;
  defaultScheduleReminderLeadMinutes: number;
  scheduleReminderLeadCustom: boolean;
}
