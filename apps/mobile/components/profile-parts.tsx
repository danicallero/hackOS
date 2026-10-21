import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { colors, radius, type } from "@/theme";

/** Contacts-style action tile: icon above a short label. */
export function QuickAction({
  icon,
  iconTint = colors.accent,
  title,
  label,
  selected,
  busy,
  onPress,
  iconNode,
  dimmed = false,
  accessory,
}: {
  icon: SymbolViewProps["name"];
  iconTint?: SymbolViewProps["tintColor"];
  /** Replaces the symbol, e.g. the cross-platform favourite star. */
  iconNode?: ReactNode;
  /** The visible caption. */
  title: string;
  /** The spoken action, which may differ from the caption (e.g. "Remove from favourites"). */
  label: string;
  selected?: boolean;
  busy: boolean;
  onPress: () => void;
  /** Greyed, for a tile the owner has chosen not to share (#934). */
  dimmed?: boolean;
  /** Sits in the tile's top corner, outside the dimming (the owner's eye). */
  accessory?: ReactNode;
}) {
  return (
    <View style={{ flex: 1 }}>
      <PressableFeedback
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy, disabled: busy, selected }}
        disabled={busy}
        feedback="row"
        focusRadius={radius.container}
        onPress={onPress}
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: radius.container,
          flex: 1,
          gap: 6,
          justifyContent: "center",
          minHeight: 64,
          opacity: dimmed ? 0.4 : 1,
          paddingHorizontal: 8,
          paddingVertical: 10,
        }}
      >
        {busy ? (
          <AppActivityIndicator color={colors.accent} />
        ) : (
          (iconNode ?? <SymbolView accessible={false} name={icon} size={22} tintColor={iconTint} />)
        )}
        <Text
          numberOfLines={1}
          style={{ color: colors.accent, fontSize: type.footnote.fontSize, fontWeight: "600" }}
        >
          {title}
        </Text>
      </PressableFeedback>
      {accessory ? (
        <View style={{ position: "absolute", right: 4, top: 4 }}>{accessory}</View>
      ) : null}
    </View>
  );
}

/**
 * The owner's eye (#934): open means scanners see the element, slashed means
 * they do not. Sits on the element it governs; the element itself is greyed
 * by its caller when hidden.
 */
export function VisibilityToggle({
  visible,
  label,
  onChange,
}: {
  visible: boolean;
  /** What it governs, e.g. "CV". */
  label: string;
  onChange: (visible: boolean) => void;
}) {
  return (
    <PressableFeedback
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: visible }}
      feedback="row"
      focusRadius={radius.container}
      hitSlop={8}
      onPress={() => onChange(!visible)}
      style={{
        alignItems: "center",
        backgroundColor: colors.surface,
        borderColor: colors.separator,
        borderRadius: radius.container,
        borderWidth: 1,
        height: 28,
        justifyContent: "center",
        width: 28,
      }}
    >
      <SymbolView
        accessible={false}
        name={visible ? "eye" : "eye.slash"}
        size={15}
        tintColor={visible ? colors.accent : colors.secondaryLabel}
      />
    </PressableFeedback>
  );
}

/**
 * The owner's note in a profile or company sheet: one row the height of a
 * {@link DetailRow} (56pt minimum, 16pt side padding), its text vertically
 * centred, so a one-line note sits like the Links and Location rows (#935).
 */
export function NoteRow({
  note,
  hint,
  onPress,
}: {
  note: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={{
        justifyContent: "center",
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text
        selectable
        style={{ color: colors.label, fontSize: type.callout.fontSize, lineHeight: 22 }}
      >
        {note}
      </Text>
    </PressableFeedback>
  );
}

/**
 * Label over value, so long values and translations wrap instead of
 * truncating. Without a label the value stands alone (a list of names).
 */
export function DetailRow({
  icon,
  label,
  value,
  onPress,
  valueNode,
  trailing,
  dimmed = false,
}: {
  icon: SymbolViewProps["name"];
  label?: string;
  value: string;
  onPress?: () => void;
  /** Replaces the value text, e.g. the owner's input (#934). */
  valueNode?: ReactNode;
  /** After the value, outside the dimming (the owner's eye). */
  trailing?: ReactNode;
  /** Greyed, for data the owner has chosen not to share. */
  dimmed?: boolean;
}) {
  const content = (
    <>
      <SymbolView accessible={false} name={icon} size={20} tintColor={colors.accent} />
      <View style={{ flex: 1, gap: 2, opacity: dimmed ? 0.4 : 1 }}>
        {label ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}>
            {label}
          </Text>
        ) : null}
        {valueNode ?? (
          <Text
            selectable={!onPress}
            style={{
              color: onPress ? colors.interactiveText : colors.label,
              fontSize: type.callout.fontSize,
              lineHeight: 22,
            }}
          >
            {value}
          </Text>
        )}
      </View>
      {trailing}
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
  if (valueNode || trailing) {
    return <View style={style}>{content}</View>;
  }
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label ? `${label}, ${value}` : value} style={style}>
        {content}
      </View>
    );
  }
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="link"
      accessibilityLabel={label ? `${label}, ${value}` : value}
      onPress={onPress}
      style={style}
    >
      {content}
    </PressableFeedback>
  );
}
