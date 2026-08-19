import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AdaptiveBackButton } from "@/components/native-ui";
import { PresenceManagement } from "@/components/presence-management";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const CONTENT_PADDING = 16;
// The floating back button sits at `topInset + 12` with a 44pt diameter —
// the page title has to clear that whole row.
const BUTTON_ROW_HEIGHT = 60;

export function PresenceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();

  return (
    <>
      <ScrollView
        contentContainerStyle={{
          gap: 22,
          paddingBottom: 40,
          paddingHorizontal: CONTENT_PADDING,
          paddingTop: insets.top + BUTTON_ROW_HEIGHT,
        }}
        style={{ backgroundColor: colors.background }}
      >
        <View>
          <Text
            selectable
            accessibilityRole="header"
            style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}
          >
            {t("presenceTimeline")}
          </Text>
        </View>

        {/* This subpage always shows the summary + timeline, unlike the
            compact link on the profile which hides for an unaccredited
            person with no signals yet — reaching here already implies
            there's something to look at. */}
        <PresenceManagement accredited userId={userId} />
      </ScrollView>

      <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
    </>
  );
}
