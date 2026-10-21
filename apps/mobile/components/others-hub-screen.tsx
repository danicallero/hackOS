import { useRouter } from "expo-router";
import { useRef } from "react";
import { ScrollView, useColorScheme, View } from "react-native";
import { AndroidStatusBarScrim, InfoRow, Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { OVERFLOW_TAB_ICON, OVERFLOW_TAB_LABEL_KEY, OVERFLOW_TAB_ROUTE } from "@/lib/overflow-tabs";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { useTabPresentation } from "@/lib/tab-presentation";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useTrueTopScroll } from "@/lib/use-true-top-scroll";
import { useParticipantLayout } from "@/theme/layout-participant";

/**
 * Fallback screen for a direct `/others` link. Normal selections use the
 * custom tab bar's native menu on every platform; this screen still lists
 * the same destinations when a regular-width device lands on the hub route.
 */
export function OthersHubScreen() {
  const readable = useParticipantLayout("list");
  useColorScheme();
  const router = useRouter();
  const { t } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const { me } = useMeContext();
  const { overflow: ids } = useTabPresentation(me?.capabilities ?? [], {
    hasQueueItems: me?.hasQueueItems ?? false,
  });

  const trueTop = useTrueTopScroll(scrollRef);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        {...trueTop.scrollProps}
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 20,
          ...readable.content,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
      >
        <Section>
          {ids.map((id, index) => (
            <View key={id}>
              {index > 0 ? <Separator inset={48} /> : null}
              <PressableFeedback
                feedback="opacity"
                accessibilityLabel={t(OVERFLOW_TAB_LABEL_KEY[id])}
                accessibilityRole="button"
                onPress={() => router.replace(OVERFLOW_TAB_ROUTE[id])}
              >
                <InfoRow
                  label={t(OVERFLOW_TAB_LABEL_KEY[id])}
                  value=""
                  icon={OVERFLOW_TAB_ICON[id]}
                  accessoryIcon="chevron.right"
                />
              </PressableFeedback>
            </View>
          ))}
        </Section>
      </ScrollView>
      <AndroidStatusBarScrim />
    </View>
  );
}
