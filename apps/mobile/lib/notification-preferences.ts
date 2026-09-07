export type NotificationChannel = "in_app" | "email" | "push";

export interface NotificationPreferenceOverride {
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationPreferences {
  channels: NotificationChannel[];
  mandatoryCategories: string[];
  overrides: NotificationPreferenceOverride[];
}

export type NotificationPreferenceUpdate = NotificationPreferenceOverride;

/** Mirrors the server's ON CONFLICT upsert for an instant optimistic view. */
export function withNotificationOverrides(
  prefs: NotificationPreferences,
  updates: NotificationPreferenceUpdate[],
): NotificationPreferences {
  const overrides = [...prefs.overrides];
  for (const update of updates) {
    const index = overrides.findIndex(
      (row) => row.category === update.category && row.channel === update.channel,
    );
    if (index === -1) overrides.push(update);
    else overrides[index] = update;
  }
  return { ...prefs, overrides };
}
