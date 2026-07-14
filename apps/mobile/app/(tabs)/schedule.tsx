import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";

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
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { items: rows } = await apiFetch<{ items: ScheduleItem[] }>("/api/public/activities");
    setItems(rows);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>{t("scheduleEmpty")}</Text>}
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
