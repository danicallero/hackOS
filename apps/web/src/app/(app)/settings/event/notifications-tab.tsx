"use client";

// Automatic notifications category (H45, H51): the event-level switch and lead
// time of the schedule-item reminder. People's own opt-ins stay in their
// preferences; this only decides whether the job runs and how early. One
// draft and one save footer for the category (R011).

import {
  type NotificationAutomationSettings,
  SCHEDULE_REMINDER_LEAD_MINUTES_MAX,
  SCHEDULE_REMINDER_LEAD_MINUTES_MIN,
} from "@hackos/shared/notification-automation";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { FormActions } from "@/components/common/form-actions";
import { SectionCard } from "@/components/common/section-card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { TimingField } from "./timing-field";
import { useCategorySaveState } from "./use-category-save-state";

interface Draft {
  scheduleRemindersEnabled: boolean;
  /** Null while the field is empty or out of range. */
  scheduleReminderLeadMinutes: number | null;
  defaultLeadMinutes: number;
}

function toDraft(settings: NotificationAutomationSettings): Draft {
  return {
    scheduleRemindersEnabled: settings.scheduleRemindersEnabled,
    scheduleReminderLeadMinutes: settings.scheduleReminderLeadMinutes,
    defaultLeadMinutes: settings.defaultScheduleReminderLeadMinutes,
  };
}

const sameDraft = (a: Draft, b: Draft) =>
  a.scheduleRemindersEnabled === b.scheduleRemindersEnabled &&
  a.scheduleReminderLeadMinutes === b.scheduleReminderLeadMinutes;

export function NotificationsTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);

  const isDirty = saved !== null && draft !== null && !sameDraft(saved, draft);
  const invalid =
    draft !== null && draft.scheduleRemindersEnabled && draft.scheduleReminderLeadMinutes === null;
  const [saveState, setSaveState] = useCategorySaveState(isDirty, onDirtyChange);

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const settings = await api.get<NotificationAutomationSettings>(
        "/api/notifications/automation",
      );
      const next = toDraft(settings);
      setSaved(next);
      setDraft(next);
      setStatus("ready");
    } catch (err) {
      setLoadError(apiErrorText(err, t, t("couldNotLoadNotificationSettings")));
      setStatus("error");
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetching the settings is an external-system sync on mount.
    void load();
  }, [load]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft || pending || invalid) return;
    setPending(true);
    setSaveState("saving");
    try {
      const settings = await api.put<NotificationAutomationSettings>(
        "/api/notifications/automation",
        {
          scheduleRemindersEnabled: draft.scheduleRemindersEnabled,
          scheduleReminderLeadMinutes: draft.scheduleReminderLeadMinutes ?? undefined,
        },
      );
      const next = toDraft(settings);
      setSaved(next);
      setDraft(next);
      setSaveState("saved");
      toast.success(t("saved"), { compactTitle: t("notificationsAutomationTitle") });
    } catch (err) {
      setSaveState("error");
      toast.error(
        apiErrorText(err, t, t("couldNotSaveNotificationSettings")),
        t("notificationsAutomationTitle"),
      );
    } finally {
      setPending(false);
    }
  }

  if (status === "error") {
    return (
      <ContextualError
        message={loadError ?? t("couldNotLoadNotificationSettings")}
        onRetry={() => void load()}
      />
    );
  }
  if (status === "loading" || !draft) {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label={t("loading")}>
        <Skeleton className="h-[var(--control-height-default)] w-48" />
        <Skeleton className="h-[var(--control-height-default)] w-64" />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SectionCard
        variant="plain"
        footerClassName="justify-start"
        stickyFooter
        footer={<FormActions pending={pending} state={saveState} disabled={!isDirty || invalid} />}
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="schedule-reminders-enabled" className="font-normal">
              {t("activityReminders")}
            </Label>
            <Switch
              id="schedule-reminders-enabled"
              checked={draft.scheduleRemindersEnabled}
              onCheckedChange={(scheduleRemindersEnabled) =>
                setDraft((prev) => (prev ? { ...prev, scheduleRemindersEnabled } : prev))
              }
            />
          </div>
          {draft.scheduleRemindersEnabled && (
            <TimingField
              id="schedule-reminder-lead"
              label={t("scheduleReminderLead")}
              value={draft.scheduleReminderLeadMinutes}
              defaultValue={draft.defaultLeadMinutes}
              min={SCHEDULE_REMINDER_LEAD_MINUTES_MIN}
              max={SCHEDULE_REMINDER_LEAD_MINUTES_MAX}
              onChange={(scheduleReminderLeadMinutes) =>
                setDraft((prev) => (prev ? { ...prev, scheduleReminderLeadMinutes } : prev))
              }
            />
          )}
        </div>
      </SectionCard>
    </form>
  );
}
