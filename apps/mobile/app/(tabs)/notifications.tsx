import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch } from "react-native";

import { Text, View } from "@/components/Themed";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

type Channel = "in_app" | "email" | "push" | "discord";

interface Preferences {
  channels: Channel[];
  mandatoryCategories: string[];
  overrides: { category: string; channel: Channel; enabled: boolean }[];
}

/** H51: which channels a participant wants per notification category (queue calls stay mandatory). */
export default function NotificationsScreen() {
  const { t } = useLocale();
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  useEffect(() => {
    void apiFetch<Preferences>("/api/me/notification-preferences").then(setPrefs);
  }, []);

  function enabledFor(category: string, channel: Channel): boolean {
    const override = prefs?.overrides.find((o) => o.category === category && o.channel === channel);
    return override ? override.enabled : true;
  }

  async function toggle(category: string, channel: Channel, next: boolean) {
    const updated = await apiFetch<Preferences>("/api/me/notification-preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: [{ category, channel, enabled: next }] }),
    });
    setPrefs(updated);
  }

  if (!prefs) return null;

  const editableCategories = ["announcements", "application"];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>{t("notificationsMandatoryHint")}</Text>
      {editableCategories.map((category) => (
        <View key={category} style={styles.card}>
          <Text style={styles.title}>{category}</Text>
          {prefs.channels.map((channel) => (
            <View key={channel} style={styles.row}>
              <Text style={styles.channelLabel}>{channel}</Text>
              <Switch
                value={enabledFor(category, channel)}
                onValueChange={(next) => void toggle(category, channel, next)}
              />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 16 },
  hint: { opacity: 0.7, fontSize: 13 },
  card: {
    gap: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  title: { fontSize: 16, fontWeight: "700", textTransform: "capitalize" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  channelLabel: { textTransform: "capitalize" },
});
