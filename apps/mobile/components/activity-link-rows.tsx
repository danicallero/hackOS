import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import { formatEventTime, useEventTimeZone } from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { colors, type } from "@/theme";

export interface ActivityLink {
  id: number;
  title: string;
  startsAt: string;
  location: string | null;
}

/** Schedule items as rows (day and time, title, place) that open the schedule detail. */
export function ActivityLinkSection({ title, items }: { title: string; items: ActivityLink[] }) {
  const router = useRouter();
  const { language } = useLocale();
  const zone = useEventTimeZone();
  if (items.length === 0) return null;
  return (
    <Section title={title}>
      {items.map((item, index) => {
        const when = formatEventTime(
          item.startsAt,
          language,
          { weekday: "short", hour: "2-digit", minute: "2-digit" },
          zone,
        );
        return (
          <View key={item.id}>
            {index > 0 ? <Separator /> : null}
            <PressableFeedback
              feedback="row"
              accessibilityRole="button"
              onPress={() => router.push(`/schedule/${item.id}`)}
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: 12,
                minHeight: 56,
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text
                  numberOfLines={2}
                  style={{ color: colors.label, fontSize: type.body.fontSize, fontWeight: "600" }}
                >
                  {item.title}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
                >
                  {[when, item.location].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <SymbolView
                name="chevron.right"
                size={13}
                tintColor={colors.tertiaryLabel}
                accessible={false}
              />
            </PressableFeedback>
          </View>
        );
      })}
    </Section>
  );
}
