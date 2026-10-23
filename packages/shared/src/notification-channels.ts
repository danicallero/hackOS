/**
 * Which channels reach a person (H51, H52). Email is an opt-in for the
 * high-volume categories below: by default it only goes to people with no
 * mobile device registered, who would otherwise have no way to be reached
 * outside the web app. A registered device replaces it with push unless the
 * person chose email. The API (`resolveChannels`) and both clients share this
 * rule so what a screen shows is what gets sent.
 */

export type NotificationChannel = "in_app" | "email" | "push";

export const QUEUE_CATEGORY = "queue";
export const REMINDER_CATEGORY = "schedule";
export const CHALLENGE_CATEGORY = "challenge";

/** Categories whose email is off while a mobile device is registered. */
export const EMAIL_OPT_IN_CATEGORIES = [QUEUE_CATEGORY, REMINDER_CATEGORY, CHALLENGE_CATEGORY];

export interface ChannelPreferenceState {
  mandatoryCategories: string[];
  emailOptInCategories: string[];
  hasPushDevice: boolean;
  overrides: { category: string; channel: NotificationChannel; enabled: boolean }[];
}

/** Email as sent when the person has not chosen: on only without a mobile device. */
export function emailDefault(state: Pick<ChannelPreferenceState, "hasPushDevice">): boolean {
  return !state.hasPushDevice;
}

/** Whether `channel` currently delivers `category` for this person. */
export function channelEnabled(
  state: ChannelPreferenceState,
  category: string,
  channel: NotificationChannel,
): boolean {
  const override = state.overrides.find(
    (row) => row.category === category && row.channel === channel,
  );
  if (channel === "email" && state.emailOptInCategories.includes(category)) {
    // Queue notices always reach someone: without a device email can't be turned off.
    if (state.mandatoryCategories.includes(category) && !state.hasPushDevice) return true;
    return override?.enabled ?? emailDefault(state);
  }
  if (state.mandatoryCategories.includes(category)) return true;
  return override?.enabled ?? true;
}

/** Without a device, queue email is the only way to be reached, so it is locked on. */
export function emailLocked(state: ChannelPreferenceState, category: string): boolean {
  return state.mandatoryCategories.includes(category) && !state.hasPushDevice;
}
