import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ReactNode, RefObject } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  useColorScheme,
  View,
} from "react-native";

import { colors } from "@/theme/colors";

export function AuthScreen({ children }: { children: ReactNode }) {
  useColorScheme();
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 48,
        paddingBottom: 32,
      }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
    >
      <View style={{ alignSelf: "center", gap: 24, maxWidth: 440, width: "100%" }}>{children}</View>
    </ScrollView>
  );
}

export function AuthHeader({
  title,
  description,
  icon = "sparkles",
}: {
  title: string;
  description: string;
  icon?: SymbolViewProps["name"];
}) {
  return (
    <View style={{ alignItems: "center", gap: 14 }}>
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
      <View style={{ alignItems: "center", gap: 6 }}>
        <Text selectable style={{ color: colors.label, fontSize: 28, fontWeight: "800" }}>
          {title}
        </Text>
        <Text
          selectable
          style={{
            color: colors.secondaryLabel,
            fontSize: 16,
            lineHeight: 22,
            textAlign: "center",
          }}
        >
          {description}
        </Text>
      </View>
    </View>
  );
}

export function AuthField({
  label,
  inputRef,
  error,
  ...props
}: TextInputProps & {
  label: string;
  inputRef?: RefObject<TextInput | null>;
  error?: string | null;
}) {
  return (
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>
        {label}
      </Text>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        placeholderTextColor={colors.tertiaryLabel}
        selectionColor={colors.accent}
        style={{
          backgroundColor: colors.surface,
          borderColor: error ? colors.destructive : colors.separator,
          borderCurve: "continuous",
          borderRadius: 12,
          borderWidth: 1,
          color: colors.label,
          fontSize: 17,
          minHeight: 52,
          paddingHorizontal: 14,
        }}
        {...props}
      />
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

export function AuthAlert({ message }: { message: string }) {
  return (
    <View
      accessibilityRole="alert"
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
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.accent,
        borderCurve: "continuous",
        borderRadius: 12,
        justifyContent: "center",
        minHeight: 52,
        opacity: disabled || busy ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <Text style={{ color: colors.accentText, fontSize: 17, fontWeight: "700" }}>{label}</Text>
      )}
    </Pressable>
  );
}
