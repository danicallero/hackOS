"use client";

// H51: first-run prompt for people with event access. Email is off for queue,
// activity reminders and challenges unless chosen (or there is no mobile app);
// answering once, on web or mobile, stops it everywhere.

import { channelEnabled, emailLocked } from "@hackos/shared/notification-channels";
import { useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { Modal } from "@/components/common/modal";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { isProfileTasksDismissed } from "@/lib/meal-plan";
import {
  type NotificationChannel,
  notificationsApi,
  type PreferencesResponse,
} from "@/lib/notifications";
import { useSessionContext } from "@/lib/session";

const CATEGORIES = ["queue", "schedule", "challenge"] as const;

export function NotificationOnboardingDialog() {
  const { me, refresh } = useSessionContext();
  const { t } = useLocale();
  const [prefs, setPrefs] = useState<PreferencesResponse | null>(null);
  const [email, setEmail] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The profile prompt goes first; this one waits until it is done or put off.
  const profileTasksPending =
    (me?.pendingProfileTasks ?? []).length > 0 && !isProfileTasksDismissed(me?.id ?? 0);
  const required = me?.notificationOnboardingRequired === true && !profileTasksPending;

  useEffect(() => {
    if (!required) return;
    let cancelled = false;
    notificationsApi
      .getPreferences()
      .then((loaded) => {
        if (cancelled || !loaded.onboardingRequired) return;
        setPrefs(loaded);
        setEmail(
          Object.fromEntries(CATEGORIES.map((c) => [c, channelEnabled(loaded, c, "email")])),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [required]);

  if (!required || !prefs || !open) return null;
  const state = prefs;

  async function save() {
    setPending(true);
    setError(null);
    try {
      // Only choices that differ from today's behavior are stored.
      const items = CATEGORIES.filter(
        (c) => !emailLocked(state, c) && email[c] !== channelEnabled(state, c, "email"),
      ).map((category) => ({
        category,
        channel: "email" as NotificationChannel,
        enabled: email[category] === true,
      }));
      await notificationsApi.completeOnboarding(items);
      await refresh();
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotSavePreference")));
    } finally {
      setPending(false);
    }
  }

  const labels: Record<(typeof CATEGORIES)[number], string> = {
    queue: t("categoryQueueCalls"),
    schedule: t("categoryReminderChannels"),
    challenge: t("challenges"),
  };

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !pending) setOpen(false);
      }}
      title={t("notificationOnboardingTitle")}
      size="md"
      footer={
        <Button onClick={() => void save()} loading={pending}>
          {t("done")}
        </Button>
      }
    >
      <div className="space-y-4 pb-1">
        <p className="text-muted-foreground text-sm">
          {state.hasPushDevice
            ? t("notificationOnboardingWithApp")
            : t("notificationOnboardingNoApp")}
        </p>
        {error && <ContextualError message={error} />}
        <div className="divide-y divide-border/60">
          {CATEGORIES.map((category) => (
            <div key={category} className="flex items-center justify-between gap-3 py-3">
              <Label htmlFor={`onboarding-email-${category}`} className="font-normal">
                {labels[category]} · {t("email")}
              </Label>
              <Switch
                id={`onboarding-email-${category}`}
                checked={email[category] ?? false}
                disabled={pending || emailLocked(state, category)}
                onCheckedChange={(checked) =>
                  setEmail((prev) => ({ ...prev, [category]: checked }))
                }
              />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
