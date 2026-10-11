import { Stack, useLocalSearchParams } from "expo-router";
import { ReminderPickerScreen } from "@/components/reminders-view";
import { useLocale } from "@/lib/i18n";
import { scheduleTypeLabel } from "@/lib/schedule";

/**
 * H59: add or remove reminders for every upcoming activity, or one kind;
 * `subscribed=1` lists only the upcoming reminders ("Coming up" → See all).
 */
export default function ReminderPickerRoute() {
  const { t } = useLocale();
  const { kind = "all", subscribed } = useLocalSearchParams<{
    kind: string;
    subscribed?: string;
  }>();
  const subscribedOnly = kind === "all" && subscribed === "1";
  const title = subscribedOnly
    ? t("alertsUpcoming")
    : kind === "all"
      ? t("notificationsChooseActivity")
      : scheduleTypeLabel(kind, t);
  return (
    <>
      <Stack.Screen options={{ title }} />
      <ReminderPickerScreen kind={kind} subscribedOnly={subscribedOnly} />
    </>
  );
}
