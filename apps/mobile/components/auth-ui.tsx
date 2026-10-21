import { type ReactNode, type RefObject, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { useAuthFrameExtra } from "@/lib/auth-frame";
import { colors, radius, space, type } from "@/theme";

export function AuthScreen({
  children,
  footer,
  scrollable = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
}) {
  const safe = useSafeAreaInsets();
  const extra = useAuthFrameExtra();
  if (!scrollable) {
    return (
      <FixedAuthScreen extra={extra} footer={footer}>
        {children}
      </FixedAuthScreen>
    );
  }
  // The stack already pads the side column; "automatic" would inset the scroll content by the
  // horizontal safe area a second time (a foldable's column pushed the form far off-centre), so
  // only the vertical safe area is added here.
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        flexGrow: 1,
        paddingLeft: 24 + extra.left,
        paddingRight: 24 + extra.right,
        paddingTop: safe.top + 56,
        paddingBottom: safe.bottom + 40,
      }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ alignSelf: "center", gap: 24, maxWidth: 440, width: "100%" }}>
        {children}
        {footer ? (
          <View
            style={{
              borderTopColor: colors.separator,
              borderTopWidth: 1,
              paddingTop: 14,
            }}
          >
            {footer}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

/**
 * Moves the centered form on the compositor while keeping the footer fixed. Only the vertical
 * safe area is applied here: the stack already pads the side column, and a second horizontal
 * inset pushed the form far off-centre on a foldable.
 */
function FixedAuthScreen({
  children,
  footer,
  extra,
}: {
  children: ReactNode;
  footer?: ReactNode;
  extra: { left: number; right: number };
}) {
  const keyboard = useAnimatedKeyboard();
  const formStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.min(keyboard.height.value * 0.38, 160) }],
  }));

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ backgroundColor: colors.background, flex: 1 }}>
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <View
          style={{
            alignSelf: "center",
            flex: 1,
            maxWidth: 440,
            paddingBottom: 16,
            paddingLeft: 24 + extra.left,
            paddingRight: 24 + extra.right,
            paddingTop: 24,
            width: "100%",
          }}
        >
          <Animated.View style={[{ flex: 1, justifyContent: "center" }, formStyle]}>
            <View style={{ gap: 24 }}>{children}</View>
          </Animated.View>
          {footer ? (
            <View
              style={{
                borderTopColor: colors.separator,
                borderTopWidth: 1,
                paddingTop: 14,
              }}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

export function AuthHeader({
  title,
  description,
  context,
  icon,
  align = "center",
}: {
  title: string;
  description?: string;
  context?: string;
  icon?: SymbolViewProps["name"];
  align?: "center" | "leading";
}) {
  const leading = align === "leading";
  return (
    <View style={{ alignItems: leading ? "flex-start" : "center", gap: 14 }}>
      {icon ? (
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.accent,
            borderCurve: "continuous",
            borderRadius: 20,
            justifyContent: "center",
            minHeight: 68,
            minWidth: 68,
          }}
        >
          <SymbolView name={icon} tintColor={colors.accentText} size={30} accessible={false} />
        </View>
      ) : null}
      <View style={{ alignItems: leading ? "flex-start" : "center", gap: 6 }}>
        {context ? (
          <Text
            selectable
            style={{
              color: colors.interactiveText,
              fontSize: 15,
              fontWeight: "600",
              textAlign: leading ? "left" : "center",
            }}
          >
            {context}
          </Text>
        ) : null}
        <Text
          selectable
          accessibilityRole="header"
          style={{
            color: colors.label,
            fontSize: leading ? 32 : 28,
            fontWeight: "800",
            textAlign: leading ? "left" : "center",
          }}
        >
          {title}
        </Text>
        {description ? (
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: 16,
              textAlign: leading ? "left" : "center",
            }}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function AuthField({
  label,
  inputRef,
  error,
  showPasswordLabel,
  hidePasswordLabel,
  style,
  onBlur,
  onFocus,
  secureTextEntry,
  ...props
}: TextInputProps & {
  label: string;
  inputRef?: RefObject<TextInput | null>;
  error?: string | null;
  showPasswordLabel?: string;
  hidePasswordLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const canRevealPassword = Boolean(secureTextEntry && showPasswordLabel && hidePasswordLabel);

  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: error ? colors.destructive : focused ? colors.accent : colors.separator,
          borderCurve: "continuous",
          borderRadius: 12,
          borderWidth: focused ? 2 : 1,
          flexDirection: "row",
          minHeight: 52,
        }}
      >
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          aria-invalid={Boolean(error)}
          placeholderTextColor={colors.secondaryLabel}
          selectionColor={colors.accent}
          secureTextEntry={secureTextEntry && !passwordVisible}
          style={[
            {
              color: colors.label,
              flex: 1,
              fontSize: 17,
              minHeight: 50,
              paddingHorizontal: 14,
              paddingVertical: 12,
            },
            style,
          ]}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          {...props}
        />
        {canRevealPassword ? (
          <Pressable
            accessibilityLabel={passwordVisible ? hidePasswordLabel : showPasswordLabel}
            accessibilityRole="button"
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={({ pressed }) => ({
              alignItems: "center",
              alignSelf: "stretch",
              justifyContent: "center",
              minHeight: 52,
              minWidth: 52,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <SymbolView
              accessible={false}
              name={passwordVisible ? "eye.slash" : "eye"}
              size={20}
              tintColor={colors.interactiveText}
              weight="medium"
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text
          selectable
          accessibilityRole="alert"
          style={{ color: colors.destructive, fontSize: 13, lineHeight: 18 }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function AuthAlert({ message, testID }: { message: string; testID?: string }) {
  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      style={{
        backgroundColor: colors.destructiveSurface,
        borderCurve: "continuous",
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text selectable style={{ color: colors.onDestructiveSurface, fontSize: 14 }}>
        {message}
      </Text>
    </View>
  );
}

export function AuthButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <PressableFeedback
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      disabled={disabled || busy}
      feedback="scale"
      haptic="light"
      onPress={onPress}
      testID={testID}
      style={{
        alignItems: "center",
        backgroundColor: colors.primaryAction,
        borderCurve: "continuous",
        borderRadius: radius.control,
        flexDirection: "row",
        gap: space.sm,
        justifyContent: "center",
        minHeight: 52,
        paddingHorizontal: space.lg,
      }}
    >
      {busy ? <AppActivityIndicator color={colors.primaryActionText} /> : null}
      <Text style={[type.body, { color: colors.primaryActionText, fontWeight: "700" }]}>
        {label}
      </Text>
    </PressableFeedback>
  );
}
