import { Stack, useLocalSearchParams } from "expo-router";
import { ReminderPickerScreen } from "@/components/reminders-view";
import { useLocale } from "@/lib/i18n";
import { scheduleTypeLabel } from "@/lib/schedule";

/** H59: add or remove reminders for every upcoming activity, or one kind. */
export default function ReminderPickerRoute() {
  const { t } = useLocale();
  const { kind = "all" } = useLocalSearchParams<{ kind: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: kind === "all" ? t("notificationsChooseActivity") : scheduleTypeLabel(kind, t),
        }}
      />
      <ReminderPickerScreen kind={kind} />
    </>
  );
}
