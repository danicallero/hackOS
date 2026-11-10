"use client";

import { channelEnabled, emailLocked } from "@hackos/shared/notification-channels";
import { ContextualError } from "@/components/common/contextual-error";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useLocale } from "@/lib/i18n";
import type { NotificationChannel, PreferencesResponse } from "@/lib/notifications";

export const NOTIFICATION_CATEGORIES = ["queue", "schedule", "challenge"] as const;

export function initialEmailChoices(prefs: PreferencesResponse): Record<string, boolean> {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((c) => [c, channelEnabled(prefs, c, "email")]),
  );
}

/** Only choices that differ from today's behavior are stored. */
export function emailChoiceItems(prefs: PreferencesResponse, email: Record<string, boolean>) {
  return NOTIFICATION_CATEGORIES.filter(
    (c) => !emailLocked(prefs, c) && email[c] !== channelEnabled(prefs, c, "email"),
  ).map((category) => ({
    category,
    channel: "email" as NotificationChannel,
    enabled: email[category] === true,
  }));
}

/** First-run email choices (H51), shared by the entry dialog and the onboarding step. */
export function NotificationChoices({
  prefs,
  email,
  onChange,
  pending,
  error,
}: {
  prefs: PreferencesResponse;
  email: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  pending: boolean;
  error: string | null;
}) {
  const { t } = useLocale();
  const labels: Record<(typeof NOTIFICATION_CATEGORIES)[number], string> = {
    queue: t("categoryQueueCalls"),
    schedule: t("categoryReminderChannels"),
    challenge: t("challenges"),
  };
  return (
    <div className="space-y-4 pb-1">
      <p className="text-muted-foreground text-sm">
        {prefs.hasPushDevice
          ? t("notificationOnboardingWithApp")
          : t("notificationOnboardingNoApp")}
      </p>
      {error && <ContextualError message={error} />}
      <div className="divide-y divide-border/60">
        {NOTIFICATION_CATEGORIES.map((category) => (
          <div key={category} className="flex items-center justify-between gap-3 py-3">
            <Label htmlFor={`onboarding-email-${category}`} className="font-normal">
              {labels[category]} · {t("email")}
            </Label>
            <Switch
              id={`onboarding-email-${category}`}
              checked={email[category] ?? false}
              disabled={pending || emailLocked(prefs, category)}
              onCheckedChange={(checked) => onChange({ ...email, [category]: checked })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
