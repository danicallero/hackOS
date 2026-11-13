import { ScrollView, Text, View } from "react-native";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { colors, type } from "@/theme";

export interface AvatarRowItem {
  key: string;
  name: string;
  uri: string | null;
  subtitle?: string | null;
  onPress: () => void;
}

/**
 * Horizontally scrolling round avatars with the name underneath, like the
 * "Hosts & Guests" row in Podcasts. Companies pass `kind="sponsor"`.
 */
export function AvatarRow({
  items,
  size = 92,
  kind = "person",
  inset = 16,
}: {
  items: AvatarRowItem[];
  size?: number;
  kind?: "person" | "sponsor";
  /** Leading and trailing padding; 0 inside an already padded column. */
  inset?: number;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 16, paddingHorizontal: inset }}
    >
      {items.map((item) => (
        <PressableFeedback
          key={item.key}
          feedback="opacity"
          accessibilityRole="button"
          accessibilityLabel={[item.name, item.subtitle].filter(Boolean).join(", ")}
          onPress={item.onPress}
          style={{ alignItems: "center", gap: 6, width: size + 12 }}
        >
          <PersonAvatar size={size} name={item.name} uri={item.uri} kind={kind} />
          <View style={{ alignItems: "center", gap: 1 }}>
            <Text
              numberOfLines={2}
              style={{
                color: colors.label,
                fontSize: type.footnote.fontSize,
                fontWeight: "600",
                textAlign: "center",
              }}
            >
              {item.name}
            </Text>
            {item.subtitle ? (
              <Text
                numberOfLines={1}
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.caption.fontSize,
                  textAlign: "center",
                }}
              >
                {item.subtitle}
              </Text>
            ) : null}
          </View>
        </PressableFeedback>
      ))}
    </ScrollView>
  );
}
