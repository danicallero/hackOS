import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import {
  categoryTitle,
  isNotificationCategory,
  NotificationCategoryScreen,
} from "@/components/notification-settings-screen";
import { useLocale } from "@/lib/i18n";

/** H51/H59: channel switches (and, for activities, reminders) for one notification type. */
export default function NotificationCategoryRoute() {
  const { t } = useLocale();
  const { category = "" } = useLocalSearchParams<{ category: string }>();
  if (!isNotificationCategory(category)) {
    return <Redirect href="/(tabs)/others/notification-settings" />;
  }
  return (
    <>
      <Stack.Screen options={{ title: categoryTitle(category, t) }} />
      <NotificationCategoryScreen category={category} />
    </>
  );
}
