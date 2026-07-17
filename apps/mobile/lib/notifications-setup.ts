import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { emitCategory } from "./notification-events";

/**
 * Show notifications while the app is foregrounded too — Expo's default
 * handler suppresses the banner/sound whenever the app already has focus,
 * which would make a queue call silent for anyone with the app open.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

if (Platform.OS === "android") {
  void Notifications.setNotificationChannelAsync("default", {
    name: "hackOS",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });
}

function categoryOf(data: Record<string, unknown> | undefined): string | undefined {
  const category = data?.category;
  return typeof category === "string" ? category : undefined;
}

/**
 * Wires the two Expo notification listeners once for the app's lifetime:
 * - received (foreground, or backgrounded-then-opened): re-emits the
 *   notification's `category` (apps/api/.../channels/push.ts data payload)
 *   on the local pub-sub so a mounted screen (queue.tsx) can refetch instead
 *   of waiting for its next poll.
 * - response (tap): same re-emit, plus navigates queue notifications to the
 *   queue tab — the one screen this phase actually deep-links.
 *
 * Also checks `getLastNotificationResponseAsync` for the cold-start case:
 * if the tap is what launched the app, it happened before these listeners
 * existed, so `addNotificationResponseReceivedListener` alone would miss it.
 *
 * Returns a cleanup function; call once from the root layout.
 */
export function setupNotificationListeners(navigateToQueue: () => void): () => void {
  const received = Notifications.addNotificationReceivedListener((event) => {
    emitCategory(categoryOf(event.request.content.data));
  });

  const handleResponse = (data: Record<string, unknown> | undefined) => {
    const category = categoryOf(data);
    emitCategory(category);
    if (category?.startsWith("queue")) navigateToQueue();
  };

  const responded = Notifications.addNotificationResponseReceivedListener((response) => {
    handleResponse(response.notification.request.content.data);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handleResponse(response.notification.request.content.data);
  });

  return () => {
    received.remove();
    responded.remove();
  };
}
