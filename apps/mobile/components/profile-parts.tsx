import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { colors } from "@/theme/colors";

/** Contacts-style action tile: icon above a short label. */
export function QuickAction({
  icon,
  iconTint = colors.accent,
  title,
  label,
  selected,
  busy,
  onPress,
}: {
  icon: SymbolViewProps["name"];
  iconTint?: SymbolViewProps["tintColor"];
  /** The visible caption. */
  title: string;
  /** The spoken action, which may differ from the caption (e.g. "Remove from favourites"). */
  label: string;
  selected?: boolean;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy, selected }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : colors.surface,
        borderCurve: "continuous",
        borderRadius: 14,
        flex: 1,
        gap: 6,
        justifyContent: "center",
        minHeight: 64,
        paddingHorizontal: 8,
        paddingVertical: 10,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <SymbolView accessible={false} name={icon} size={22} tintColor={iconTint} />
      )}
      <Text
        numberOfLines={1}
        style={{ color: colors.accent, fontSize: 13, fontWeight: "600" }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** Label over value, so long values and translations wrap instead of truncating. */
export function DetailRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: SymbolViewProps["name"];
  label: string;
  value: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <SymbolView accessible={false} name={icon} size={20} tintColor={colors.accent} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{label}</Text>
        <Text
          selectable={!onPress}
          style={{
            color: onPress ? colors.interactiveText : colors.label,
            fontSize: 16,
            lineHeight: 22,
          }}
        >
          {value}
        </Text>
      </View>
      {onPress ? (
        <SymbolView
          accessible={false}
          name="arrow.up.right"
          size={13}
          tintColor={colors.tertiaryLabel}
        />
      ) : null}
    </>
  );
  const style = {
    alignItems: "center" as const,
    flexDirection: "row" as const,
    gap: 16,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
  };
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}, ${value}`} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [
        style,
        { backgroundColor: pressed ? colors.elevatedSurface : undefined },
      ]}
    >
      {content}
    </Pressable>
  );
}
