import { Link, Stack } from "expo-router";
import { ScrollView, StyleSheet } from "react-native";

import { Text } from "@/components/Themed";
import { useLocale } from "@/lib/i18n";
import { colors, type } from "@/theme";

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
    fontSize: type.title3.fontSize,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: type.compact.fontSize,
    color: colors.accent,
  },
});
