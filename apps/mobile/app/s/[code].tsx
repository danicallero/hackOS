import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { collectCompanyTagHref, setPendingCompanyTag } from "@/lib/company-tag-link";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { colors, type } from "@/theme";

/**
 * #935 company-tag link `https://<event host>/s/<code>`, opened from a
 * printed QR code or any app link.
 * Signed in, it hands the code to the Diary, which collects it like a scan
 * and celebrates on the Companies album. Signed out, the code waits for
 * sign-in (`RootLayout` resumes it). Not behind the session guard, so the
 * link itself never bounces.
 */
export default function CompanyTagLinkScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const { authenticated, me } = useMeContext();
  const router = useRouter();
  const { t } = useLocale();

  useEffect(() => {
    if (!code) {
      router.replace("/");
      return;
    }
    if (!authenticated) {
      setPendingCompanyTag(code);
      router.replace("/(auth)/sign-in");
      return;
    }
    if (!me) return;
    router.replace(collectCompanyTagHref(code, me.capabilities));
  }, [code, authenticated, me, router]);

  return (
    <View
      accessibilityLabel={t("companyTagCollecting")}
      accessibilityRole="progressbar"
      style={{
        alignItems: "center",
        backgroundColor: colors.background,
        flex: 1,
        gap: 12,
        justifyContent: "center",
      }}
    >
      <AppActivityIndicator color={colors.accent} />
      <Text style={{ color: colors.secondaryLabel, fontSize: type.subhead.fontSize }}>
        {t("companyTagCollecting")}
      </Text>
    </View>
  );
}
