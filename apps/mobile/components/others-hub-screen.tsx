import { useRouter, useScrollToTop } from "expo-router";
import { useRef } from "react";
import { Pressable, ScrollView, useColorScheme, View } from "react-native";
import { AndroidStatusBarScrim, InfoRow, Section, Separator } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { OVERFLOW_TAB_ICON, OVERFLOW_TAB_LABEL_KEY, OVERFLOW_TAB_ROUTE } from "@/lib/overflow-tabs";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { overflowTabs } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";

/**
 * Fallback screen for a direct `/others` link. Normal selections use the
 * custom tab bar's native menu on every platform; this screen still lists
 * the same destinations when a regular-width device lands on the hub route.
 */
export function OthersHubScreen() {
  useColorScheme();
  const router = useRouter();
  const { t } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const { me } = useMeContext();
  const ids = overflowTabs(me?.capabilities ?? []);

  useScrollToTop(scrollRef);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 20,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
      >
        <Section>
          {ids.map((id, index) => (
            <View key={id}>
              {index > 0 ? <Separator inset={48} /> : null}
              <Pressable
                accessibilityLabel={t(OVERFLOW_TAB_LABEL_KEY[id])}
                accessibilityRole="button"
                onPress={() => router.push(OVERFLOW_TAB_ROUTE[id])}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <InfoRow
                  label={t(OVERFLOW_TAB_LABEL_KEY[id])}
                  value=""
                  icon={OVERFLOW_TAB_ICON[id]}
                  accessoryIcon="chevron.right"
                />
              </Pressable>
            </View>
          ))}
        </Section>
      </ScrollView>
      <AndroidStatusBarScrim />
    </View>
  );
}
