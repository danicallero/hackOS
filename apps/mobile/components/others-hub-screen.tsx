import { useRouter } from "expo-router";
import { Pressable, ScrollView, useColorScheme, View } from "react-native";
import { AndroidStatusBarScrim, InfoRow, Section, Separator } from "@/components/native-ui";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { OVERFLOW_TAB_ICON, OVERFLOW_TAB_LABEL_KEY, OVERFLOW_TAB_ROUTE } from "@/lib/overflow-tabs";
import { overflowTabs } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";

/**
 * The iPad/macOS equivalent of the iPhone overflow popover (see the
 * `NativeOperationsMenu` contract in app/(tabs)/_layout.tsx): a real screen
 * listing the same destinations, pushed onto — and popped back off — the
 * "Others" tab's own stack via its native header, rather than a popover
 * guessing where the tab bar item sits on screen.
 */
export function OthersHubScreen() {
  useColorScheme();
  const router = useRouter();
  const { t } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const { me } = useMeContext();
  const ids = overflowTabs(me?.capabilities ?? []);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ gap: 20, padding: 16, paddingTop: 16 + androidTopInset }}
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
