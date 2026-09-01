import Stack from "expo-router/stack";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  type ColorValue,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useReducedMotion,
} from "react-native-reanimated";
import {
  GlassView,
  type GlassViewProps,
  isRealLiquidGlassAvailable,
} from "@/components/glass-view";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { type HapticIntent, haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors } from "@/theme/colors";

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {footer ? (
        <Text
          selectable
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            lineHeight: 18,
            paddingHorizontal: 16,
          }}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function Separator({
  inset = 16,
  trailingInset = 0,
}: {
  inset?: number;
  trailingInset?: number;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.separator,
        height: 0.5,
        marginLeft: inset,
        marginRight: trailingInset,
      }}
    />
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{ color: disabled ? colors.tertiaryLabel : colors.label, flex: 1, fontSize: 16 }}
      >
        {label}
      </Text>
      <Switch disabled={disabled} onValueChange={onChange} value={value} />
    </View>
  );
}

export function InfoRow({
  label,
  value,
  icon,
  accessoryIcon,
  accessoryColor,
  accessoryLabel,
  valueStyle,
}: {
  label: string;
  value: string;
  icon?: SymbolViewProps["name"];
  accessoryIcon?: SymbolViewProps["name"];
  /** Tint for `accessoryIcon`; defaults to the neutral chevron tint. */
  accessoryColor?: SymbolViewProps["tintColor"];
  /**
   * Accessibility label for `accessoryIcon` when it conveys meaning beyond
   * decoration (e.g. a verification badge) rather than a plain disclosure
   * chevron. Leave unset for chevrons — they stay hidden from VoiceOver.
   */
  accessoryLabel?: string;
  valueStyle?: TextStyle;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      {icon ? (
        <SymbolView name={icon} tintColor={colors.accent} size={20} accessible={false} />
      ) : null}
      <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
        {label}
      </Text>
      <Text
        selectable
        style={[
          { color: colors.secondaryLabel, flexShrink: 1, fontSize: 16, textAlign: "right" },
          valueStyle,
        ]}
      >
        {value}
      </Text>
      {accessoryIcon ? (
        <SymbolView
          name={accessoryIcon}
          tintColor={accessoryColor ?? colors.tertiaryLabel}
          size={accessoryColor ? 18 : 12}
          weight="semibold"
          accessible={!!accessoryLabel}
          accessibilityLabel={accessoryLabel}
        />
      ) : null}
    </View>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "destructive";
  /**
   * Defaults to `alignSelf: "flex-start"` so the pill doesn't stretch to
   * fill a parent that defaults to `alignItems: "stretch"` (e.g. a bare
   * flex-wrap row of chips). Pass `{ alignSelf: "center" }` when the pill
   * sits inline as a direct sibling of other centered content (icons,
   * chevrons) in a row that already sets `alignItems: "center"` — otherwise
   * this default overrides that and the pill visibly drifts to the top.
   */
  style?: ViewStyle;
}) {
  const palette = {
    neutral: { background: colors.elevatedSurface, foreground: colors.secondaryLabel },
    accent: { background: colors.accentSurface, foreground: colors.onAccentSurface },
    success: { background: colors.successSurface, foreground: colors.onSuccessSurface },
    warning: { background: colors.warningSurface, foreground: colors.onWarningSurface },
    destructive: {
      background: colors.destructiveSurface,
      foreground: colors.onDestructiveSurface,
    },
  }[tone];
  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: palette.background,
          borderCurve: "continuous",
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 5,
        },
        style,
      ]}
    >
      <Text selectable style={{ color: palette.foreground, fontSize: 12, fontWeight: "700" }}>
        {children}
      </Text>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  destructive = false,
  variant = "plain",
  icon,
  haptic: hapticIntent = "light",
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
  variant?: "plain" | "filled" | "outlined";
  icon?: SymbolViewProps["name"];
  haptic?: HapticIntent | false;
  style?: ViewStyle;
  testID?: string;
}) {
  const isDisabled = disabled || busy;
  const filledDestructive = variant === "filled" && destructive;
  const disabledFilledDestructive = filledDestructive && disabled && !busy;
  const foreground = filledDestructive
    ? disabledFilledDestructive
      ? colors.tertiaryLabel
      : colors.destructive
    : variant === "filled"
      ? colors.primaryActionText
      : destructive
        ? colors.destructive
        : colors.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy }}
      disabled={isDisabled}
      onPress={() => {
        if (hapticIntent) void haptic(hapticIntent);
        onPress();
      }}
      style={({ pressed }) => [
        {
          alignItems: "center",
          backgroundColor:
            variant === "filled"
              ? destructive
                ? disabledFilledDestructive
                  ? colors.elevatedSurface
                  : pressed
                    ? colors.destructiveSurface
                    : colors.surface
                : colors.primaryAction
              : undefined,
          borderColor:
            variant === "outlined" || filledDestructive
              ? disabledFilledDestructive
                ? colors.separator
                : colors.separator
              : undefined,
          borderCurve: "continuous",
          borderRadius: variant === "plain" ? 0 : 12,
          borderWidth: variant === "outlined" || filledDestructive ? 1 : 0,
          flexDirection: "row",
          gap: 8,
          justifyContent: "center",
          minHeight: 50,
          opacity: disabledFilledDestructive
            ? 1
            : busy
              ? 0.75
              : disabled
                ? 0.45
                : pressed
                  ? 0.9
                  : 1,
          paddingHorizontal: 16,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <SymbolView name={icon} tintColor={foreground} size={18} accessible={false} />
      ) : null}
      <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Header used when the native Liquid Glass/search bar is unavailable.
 *
 * Keeping the search trigger and its expanded field in the screen tree is
 * important on iOS 18: a transparent native header still owns that area even
 * when its toolbar items are not rendered reliably. This is the same compact
 * title/search behavior used by Schedule, exposed here so other list screens
 * can share the fallback without recreating the hit targets.
 */
export function LegacyScreenHeader({
  topInset,
  title,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  onOpenSearch,
  onCloseSearch,
  searchLabel,
  searchPlaceholder,
  cancelLabel,
  leading,
  actions,
}: {
  topInset: number;
  title: string;
  searchOpen: boolean;
  searchQuery: string;
  onSearchQueryChange: (text: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  searchLabel: string;
  searchPlaceholder: string;
  cancelLabel: string;
  leading?: ReactNode;
  actions: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const headerTransition = reducedMotion ? undefined : LinearTransition.duration(180);

  return (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingTop: topInset, zIndex: 10 }}>
      <Animated.View
        key={searchOpen ? "search" : "actions"}
        entering={reducedMotion ? undefined : FadeIn.duration(180)}
        exiting={reducedMotion ? undefined : FadeOut.duration(120)}
        layout={headerTransition}
      >
        {searchOpen ? (
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: 8,
              paddingBottom: 4,
              paddingTop: 8,
            }}
          >
            <GlassView
              colorScheme="auto"
              glassEffectStyle="regular"
              style={{ borderRadius: 12, flex: 1, height: 40, overflow: "hidden" }}
            >
              <View
                style={{
                  alignItems: "center",
                  flex: 1,
                  flexDirection: "row",
                  gap: 6,
                  paddingHorizontal: 12,
                }}
              >
                <SymbolView
                  accessible={false}
                  name="magnifyingglass"
                  tintColor={colors.tertiaryLabel}
                  size={16}
                />
                <TextInput
                  autoFocus
                  accessibilityLabel={searchLabel}
                  onChangeText={onSearchQueryChange}
                  placeholder={searchPlaceholder}
                  placeholderTextColor={colors.tertiaryLabel}
                  returnKeyType="search"
                  style={{ color: colors.label, flex: 1, fontSize: 16 }}
                  value={searchQuery}
                />
              </View>
            </GlassView>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              onPress={onCloseSearch}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Text style={{ color: colors.accent, fontSize: 16, fontWeight: "600" }}>
                {cancelLabel}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View
            style={{
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "space-between",
              paddingBottom: 4,
              paddingTop: 8,
            }}
          >
            <View style={{ alignItems: "center", flex: 1, flexDirection: "row", gap: 4 }}>
              {leading}
              <Text style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}>{title}</Text>
            </View>
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              {actions}
              <GlassView
                colorScheme="auto"
                glassEffectStyle="regular"
                isInteractive
                style={{ borderRadius: 22, height: 44, width: 44 }}
              >
                <LegacyHeaderIconButton
                  icon="magnifyingglass"
                  accessibilityLabel={searchLabel}
                  onPress={onOpenSearch}
                />
              </GlassView>
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

/** A 44pt icon hit target for {@link LegacyScreenHeader} action groups. */
export function LegacyHeaderIconButton({
  icon,
  accessibilityLabel,
  accessibilityState,
  tintColor,
  onPress,
}: {
  icon: SymbolViewProps["name"];
  accessibilityLabel: string;
  accessibilityState?: { expanded?: boolean; selected?: boolean };
  tintColor?: ColorValue;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={() => {
        void haptic("light");
        onPress();
      }}
      style={({ pressed }) => ({
        alignItems: "center",
        height: 44,
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
        width: 44,
      })}
    >
      <SymbolView
        accessible={false}
        name={icon}
        tintColor={tintColor ?? colors.label}
        size={19}
        weight="semibold"
      />
    </Pressable>
  );
}

/** Android fallback for H25/H26 roster filtering: native menu triggers are not
 * consistently clickable inside the legacy header's composed glass surface. */
export function AndroidFilterMenu({
  accessibilityLabel,
  items,
  onSelect,
}: {
  accessibilityLabel: string;
  items: Array<{ id: string; label: string; selected: boolean }>;
  onSelect: (id: string) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: pressed ? 0.65 : 1,
        })}
      >
        <SymbolView
          name={
            items.some((item) => item.selected) && !items[0]?.selected
              ? "line.3.horizontal.decrease.circle.fill"
              : "line.3.horizontal.decrease"
          }
          tintColor={
            items.some((item) => item.selected) && !items[0]?.selected
              ? colors.accent
              : colors.label
          }
          size={19}
          weight="semibold"
        />
      </Pressable>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel={t("close")}
          accessibilityRole="button"
          onPress={() => setOpen(false)}
          style={{ flex: 1 }}
        />
        <View
          style={{
            backgroundColor: colors.elevatedSurface,
            borderColor: colors.separator,
            borderRadius: 14,
            borderWidth: 1,
            elevation: 12,
            overflow: "hidden",
            position: "absolute",
            right: 16,
            top: useAndroidTopInset() + 58,
            width: 240,
          }}
        >
          {items.map((item) => (
            <Pressable
              accessibilityRole="menuitem"
              accessibilityState={{ selected: item.selected }}
              key={item.id}
              onPress={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              style={({ pressed }) => ({
                alignItems: "center",
                backgroundColor: pressed ? colors.surface : "transparent",
                flexDirection: "row",
                minHeight: 48,
                paddingHorizontal: 16,
              })}
            >
              <Text style={{ color: colors.label, flex: 1, fontSize: 16 }}>{item.label}</Text>
              {item.selected ? (
                <SymbolView name="checkmark" tintColor={colors.accent} size={16} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </Modal>
    </>
  );
}

/**
 * Screen-chrome action that joins the native iOS toolbar and falls back to
 * the established floating glass control on compact widths and platforms
 * without SF toolbar icons. Use floating controls directly when the action
 * belongs to a camera or modal surface rather than to navigation.
 */
export function AdaptiveToolbarButton({
  top,
  side = "left",
  icon,
  tintColor,
  colorScheme = "auto",
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  onPress,
}: {
  top: number;
  side?: "left" | "right";
  icon: Extract<SymbolViewProps["name"], string>;
  tintColor?: SymbolViewProps["tintColor"];
  colorScheme?: GlassViewProps["colorScheme"];
  accessibilityLabel: string;
  accessibilityState?: { selected?: boolean; busy?: boolean };
  disabled?: boolean;
  onPress: () => void;
}) {
  if (process.env.EXPO_OS === "ios" && isRealLiquidGlassAvailable()) {
    return (
      <Stack.Toolbar placement={side}>
        <Stack.Toolbar.Button
          accessibilityLabel={accessibilityLabel}
          disabled={disabled}
          icon={icon}
          onPress={onPress}
          selected={accessibilityState?.selected}
          tintColor={tintColor}
        />
      </Stack.Toolbar>
    );
  }

  return (
    <FloatingGlassButton
      top={top}
      side={side}
      icon={icon}
      tintColor={tintColor}
      colorScheme={colorScheme}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={onPress}
    />
  );
}

/** Floating chrome-less icon button for camera and modal surfaces. */
export function FloatingGlassButton({
  top,
  side = "left",
  icon,
  tintColor,
  colorScheme = "auto",
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  onPress,
}: {
  top: number;
  side?: "left" | "right";
  icon: SymbolViewProps["name"];
  tintColor?: SymbolViewProps["tintColor"];
  /** Camera surfaces pass "dark" so the non-Liquid-Glass (Android, iOS <26)
      opaque fallback doesn't turn into a white pill over the viewfinder. */
  colorScheme?: GlassViewProps["colorScheme"];
  accessibilityLabel: string;
  accessibilityState?: { selected?: boolean; busy?: boolean };
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle="regular"
      isInteractive
      style={{
        borderRadius: 22,
        height: 44,
        position: "absolute",
        top,
        width: 44,
        zIndex: 200,
        ...(side === "left" ? { left: 16 } : { right: 16 }),
      }}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={onPress}
        style={{
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <SymbolView name={icon} tintColor={tintColor ?? colors.label} size={19} weight="semibold" />
      </Pressable>
    </GlassView>
  );
}

/**
 * Android draws edge-to-edge with a transparent status bar, and these
 * header-less tab screens have no native bar to blur their content under —
 * so scrolled rows slide behind the clock. An opaque band of exactly the
 * status-bar inset keeps them hidden instead. No-op on iOS, where the native
 * (large-title) bar already owns that space.
 */
export function AndroidStatusBarScrim({ color = colors.background }: { color?: ColorValue }) {
  const inset = useAndroidTopInset();
  if (inset === 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        backgroundColor: color,
        height: inset,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
      }}
    />
  );
}

/** Adaptive navigation back action; `top` is used by the non-iOS fallback. */
export function AdaptiveBackButton({
  top,
  colorScheme = "auto",
  tintColor,
  onPress,
}: {
  top: number;
  colorScheme?: GlassViewProps["colorScheme"];
  tintColor?: SymbolViewProps["tintColor"];
  onPress: () => void;
}) {
  const { t } = useLocale();
  return (
    <AdaptiveToolbarButton
      top={top}
      icon="chevron.left"
      colorScheme={colorScheme}
      tintColor={tintColor}
      accessibilityLabel={t("back")}
      onPress={onPress}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: SymbolViewProps["name"];
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 32, paddingVertical: 52 }}>
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 18,
          justifyContent: "center",
          minHeight: 64,
          minWidth: 64,
        }}
      >
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={30} accessible={false} />
      </View>
      <Text
        selectable
        accessibilityRole="header"
        style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
      >
        {title}
      </Text>
      <Text
        selectable
        style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21, textAlign: "center" }}
      >
        {description}
      </Text>
      {action}
    </View>
  );
}
