import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";

import { RequestFeedback } from "@/components/RequestFeedback";
import { Text, View } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

interface ScheduleItem {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  type: string | null;
  startsAt: string;
  endsAt: string;
}

/** H47: live public schedule — reuses GET /api/public/activities (no capability needed). */
export default function ScheduleScreen() {
  const { t, language } = useLocale();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { items: rows } = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
      setItems(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Failed to load schedule"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <RequestFeedback loading />
          ) : error ? (
            <RequestFeedback error={error} onRetry={() => void load()} />
          ) : (
            <Text style={styles.empty}>{t("scheduleEmpty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.time}>
              {new Date(item.startsAt).toLocaleString(language, {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <Text style={styles.title}>{item.title}</Text>
            {item.location ? <Text style={styles.meta}>{item.location}</Text> : null}
            {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
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
  time: { fontSize: 13, opacity: 0.6 },
  title: { fontSize: 17, fontWeight: "600" },
  meta: { fontSize: 14, opacity: 0.7 },
  description: { fontSize: 14, opacity: 0.85 },
});
