"use client";

// H51: first-run prompt for people with event access. Email is off for queue,
// activity reminders and challenges unless chosen (or there is no mobile app);
// answering once, on web or mobile, stops it everywhere.

import { useEffect, useState } from "react";
import { Modal } from "@/components/common/modal";
import {
  emailChoiceItems,
  initialEmailChoices,
  NotificationChoices,
} from "@/components/onboarding/notification-choices";
import { Button } from "@/components/ui/button";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { isProfileTasksDismissed } from "@/lib/meal-plan";
import { notificationsApi, type PreferencesResponse } from "@/lib/notifications";
import { useSessionContext } from "@/lib/session";

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
        setEmail(initialEmailChoices(loaded));
      })
      // The prompt is optional: if preferences cannot load, skip it; it returns next session.
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
      const items = emailChoiceItems(state, email);
      await notificationsApi.completeOnboarding(items);
      await refresh();
    } catch (err) {
      setError(apiErrorText(err, t, t("couldNotSavePreference")));
    } finally {
      setPending(false);
    }
  }

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
      <NotificationChoices
        prefs={state}
        email={email}
        onChange={setEmail}
        pending={pending}
        error={error}
      />
    </Modal>
  );
}
