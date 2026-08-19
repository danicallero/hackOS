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
const BUTTON_ROW_HEIGHT = 20;

export function PresenceScreen() {
  const { id, draftKind, draftAt } = useLocalSearchParams<{
    id: string;
    draftKind?: string;
    draftAt?: string;
  }>();
  const userId = Number(id);
  const router = useRouter();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const draftKindValid: "in" | "out" | null =
    draftKind === "in" || draftKind === "out" ? draftKind : null;
  const initialDraft = draftKindValid
    ? { kind: draftKindValid, occurredAt: draftAt ? new Date(draftAt) : new Date() }
    : undefined;

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 22,
          paddingBottom: 40,
          paddingHorizontal: CONTENT_PADDING,
          // Not `insets.top + BUTTON_ROW_HEIGHT`: this screen sits under the
          // same route group's invisible native nav bar as the profile
          // screen, and `automatic` above already pushes content below its
          // real height — adding `insets.top` again double-counts it.
          paddingTop: BUTTON_ROW_HEIGHT,
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
        <PresenceManagement accredited initialDraft={initialDraft} userId={userId} />
      </ScrollView>

      <AdaptiveBackButton top={insets.top + 12} onPress={() => router.back()} />
    </>
  );
}
