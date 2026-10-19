import { Stack, useLocalSearchParams } from "expo-router";
import { ReminderPickerScreen } from "@/components/reminders-view";
import { useLocale } from "@/lib/i18n";
import { scheduleTypeLabel } from "@/lib/schedule";

/** H59: add or remove reminders for every activity of one kind. */
export default function ReminderPickerRoute() {
  const { t } = useLocale();
  const { kind = "" } = useLocalSearchParams<{ kind: string }>();
  return (
    <>
      <Stack.Screen options={{ title: scheduleTypeLabel(kind, t) }} />
      <ReminderPickerScreen kind={kind} />
    </>
  );
}
