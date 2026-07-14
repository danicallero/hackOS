import { CAPABILITIES } from "@hackos/shared/capabilities";
import { StyleSheet } from "react-native";
import { Text, View } from "@/components/Themed";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";

const SCAN_CAPABILITY_LABELS: Record<string, string> = {
  [CAPABILITIES.ACCREDIT_SCAN]: "accreditation",
  [CAPABILITIES.PRESENCE_SCAN]: "presence",
  [CAPABILITIES.ACTIVITY_SCAN]: "meals/activities",
};

/**
 * Placeholder for the offline SQLite scanners (H22-H26) — deferred to a
 * later phase. Only reachable when the tab is shown, i.e. the signed-in user
 * already holds at least one scan capability (see lib/tabs.ts), so this just
 * confirms which ones and what's coming.
 */
export default function ScanScreen() {
  const { t } = useLocale();
  const { me } = useMeContext();

  const owned = (me?.capabilities ?? [])
    .filter((c) => c in SCAN_CAPABILITY_LABELS)
    .map((c) => SCAN_CAPABILITY_LABELS[c]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {t("scanComingSoon", { capabilities: owned.join(", ") || "—" })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  text: { textAlign: "center", opacity: 0.8 },
});
