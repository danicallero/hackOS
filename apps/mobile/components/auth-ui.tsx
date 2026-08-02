import { type ReactNode, type RefObject, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";

import { colors } from "@/theme/colors";

export function AuthScreen({
  children,
  footer,
  scrollable = true,
}: {
  children: ReactNode;
  footer?: ReactNode;
  scrollable?: boolean;
}) {
  useColorScheme();
  if (!scrollable) {
    return (
      <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }}>
        <KeyboardAvoidingView
          behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View
            style={{
              alignSelf: "center",
              flex: 1,
              gap: 28,
              justifyContent: "center",
              maxWidth: 440,
              paddingHorizontal: 24,
              paddingVertical: 24,
              width: "100%",
            }}
          >
            {children}
          </View>
        </KeyboardAvoidingView>
        {footer ? (
          <View
            style={{
              alignSelf: "center",
              maxWidth: 440,
              paddingBottom: 16,
              paddingHorizontal: 24,
              paddingTop: 8,
              width: "100%",
            }}
          >
            {footer}
          </View>
        ) : null}
      </SafeAreaView>
    );
  }
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 56,
        paddingBottom: 40,
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
              lineHeight: 20,
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
              lineHeight: 22,
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
      <Text selectable style={{ color: colors.destructive, fontSize: 14, lineHeight: 20 }}>
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
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.primaryAction,
        borderCurve: "continuous",
        borderRadius: 12,
        flexDirection: "row",
        gap: 8,
        justifyContent: "center",
        minHeight: 52,
        opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1,
        paddingHorizontal: 16,
        transform: [{ scale: pressed && !disabled && !busy ? 0.96 : 1 }],
      })}
    >
      {busy ? <ActivityIndicator color={colors.primaryActionText} /> : null}
      <Text style={{ color: colors.primaryActionText, fontSize: 17, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}
