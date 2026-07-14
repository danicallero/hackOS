import { EVENTS } from "@hackos/shared/events";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";

import { Text, View } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { subscribeToCategory } from "@/lib/notification-events";
import { subscribeToServerEvent } from "@/lib/server-events";

interface QueueRoom {
  id: number;
  name: string;
  location: string | null;
}

interface QueueEntry {
  entryId: number;
  challengeTitle: string;
  repoName: string;
  status: string;
  position: number | null;
  etaMinutes: number | null;
  room: QueueRoom | null;
  rooms: QueueRoom[];
}

const POLL_MS = 15_000;

/**
 * H38: participant's own queue status/position/ETA + call notices. The
 * 15s poll is a fallback safety net; the primary delivery path is the
 * "queue" push notification (apps/api/.../channels/push.ts sets
 * `data.category = "queue"`) — lib/notifications-setup.ts re-emits it on the
 * local pub-sub (lib/notification-events.ts) when it arrives, so this screen
 * refetches immediately instead of waiting out the interval, both while
 * foregrounded and when opened by tapping the notification.
 */
export default function QueueScreen() {
  const { t } = useLocale();
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await apiFetch<QueueEntry[]>("/api/queue/me");
    setEntries(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribeToCategory("queue", () => void load()), [load]);

  useEffect(() => {
    const eventTypes = [
      EVENTS.USER_QUEUE_CALLED,
      EVENTS.USER_QUEUE_PRECALL,
      EVENTS.USER_QUEUE_CHANGED,
    ];
    const cleanups = eventTypes.map((type) => subscribeToServerEvent(type, () => void load()));
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      const id = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(item) => String(item.entryId)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>{t("queueEmpty")}</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.title}>{item.challengeTitle}</Text>
            <Text style={styles.meta}>{item.repoName}</Text>
            {item.status === "called" && item.room ? (
              <View style={styles.calledBanner}>
                <Text style={styles.calledText}>{t("queueCalled", { room: item.room.name })}</Text>
              </View>
            ) : item.status === "waiting" ? (
              <Text style={styles.meta}>
                {item.position != null
                  ? t("queuePosition", { n: String(item.position) })
                  : item.status}
              </Text>
            ) : (
              <Text style={styles.meta}>{item.status}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { padding: 24, textAlign: "center", opacity: 0.6 },
  card: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
    gap: 4,
  },
  title: { fontSize: 17, fontWeight: "600" },
  meta: { fontSize: 14, opacity: 0.7 },
  calledBanner: { backgroundColor: "#e6f4ea", borderRadius: 8, padding: 10, marginTop: 4 },
  calledText: { color: "#1e7e34", fontWeight: "700" },
});
