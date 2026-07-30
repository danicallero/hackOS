import { Link, Stack } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { Text } from "@/components/Themed";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export default function NotFoundScreen() {
  const { t } = useLocale();

  return (
    <>
      <Stack.Screen options={{ title: t("screenNotFoundHeader") }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.container}
        style={{ backgroundColor: colors.background }}
      >
        <Text style={styles.title}>{t("screenNotFoundTitle")}</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>{t("goHome")}</Text>
        </Link>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    color: colors.accent,
  },
});
