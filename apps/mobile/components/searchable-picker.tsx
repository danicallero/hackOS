import { useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { type ReactNode, useLayoutEffect } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { PressableFeedback } from "@/components/pressable-feedback";
import { CircleButton } from "@/components/project-ui";
import { SymbolView } from "@/components/symbol";
import { useLocale } from "@/lib/i18n";
import { colors, radius, space, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

/**
 * The inset search field Android shows where iOS uses the native header
 * search (R025): one field leading the list, never both.
 */
export function SearchField({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string;
  value?: string;
  onChange: (text: string) => void;
}) {
  return (
    <TextInput
      accessibilityLabel={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      clearButtonMode="while-editing"
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.tertiaryLabel}
      returnKeyType="search"
      value={value}
      style={{
        ...type.body,
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: radius.container,
        color: colors.label,
        minHeight: 44,
        paddingHorizontal: space.lg,
      }}
    />
  );
}

/**
 * A choice in an inset-grouped list, as in Settings: the trailing checkmark
 * marks it, a lock marks a choice that cannot be undone here.
 */
export function CheckRow({
  label,
  detail,
  selected,
  locked = false,
  disabled = false,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  locked?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const inert = locked || disabled;
  return (
    <PressableFeedback
      feedback="row"
      // A checkmark list row is a button with the selected trait, as in UIKit.
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ selected, disabled: inert }}
      disabled={inert}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 50,
        opacity: disabled && !selected ? 0.5 : 1,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: colors.label }}>{label}</Text>
        {detail ? (
          <Text style={{ ...type.compact, color: colors.secondaryLabel }}>{detail}</Text>
        ) : null}
      </View>
      {locked ? (
        <SymbolView
          name="lock.fill"
          tintColor={colors.tertiaryLabel}
          size={15}
          accessible={false}
        />
      ) : selected ? (
        <SymbolView
          name="checkmark"
          tintColor={colors.accent}
          size={17}
          weight="semibold"
          accessible={false}
        />
      ) : null}
    </PressableFeedback>
  );
}

/**
 * A sheet that picks from a searchable catalogue (project challenges, help
 * topics): inline title, native header search on iOS, the inset field on
 * Android. Close (xmark, leading) dismisses and calls `onDiscard` so a picker
 * that edits a draft can restore it; the checkmark (trailing) confirms.
 */
export function SearchablePickerSheet({
  title,
  searchPlaceholder,
  query,
  onQuery,
  onDiscard,
  onConfirm,
  confirmDisabled = false,
  closeDisabled = false,
  children,
}: {
  title: string;
  searchPlaceholder: string;
  query: string;
  onQuery: (text: string) => void;
  /** Close: undo this visit's edits before the sheet dismisses. */
  onDiscard?: () => void;
  /** Optional save action for pickers that commit a draft to the API. */
  onConfirm?: () => void;
  confirmDisabled?: boolean;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const navigation = useNavigation();
  const readable = useParticipantLayout("form");
  const glass = isRealLiquidGlassAvailable();
  const confirm = () => {
    if (confirmDisabled) return;
    if (onConfirm) onConfirm();
    else router.back();
  };
  const close = () => {
    if (closeDisabled) return;
    onDiscard?.();
    router.back();
  };
  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerLargeTitle: false,
      headerShadowVisible: false,
      headerLeft: glass
        ? undefined
        : () => (
            <CircleButton
              icon="xmark"
              label={t("cancel")}
              disabled={closeDisabled}
              onPress={close}
            />
          ),
      // iOS 26 draws the toolbar Done below as a glass circle.
      headerRight: glass
        ? undefined
        : () => (
            <CircleButton
              icon="checkmark"
              label={t("close")}
              prominent
              disabled={confirmDisabled}
              onPress={confirm}
            />
          ),
      ...(Platform.OS === "ios"
        ? {
            headerSearchBarOptions: {
              placeholder: searchPlaceholder,
              autoCapitalize: "none",
              hideWhenScrolling: false,
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                onQuery(event.nativeEvent.text),
            },
          }
        : {}),
    });
  });
  return (
    <>
      {glass ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button
            icon="xmark"
            accessibilityLabel={t("cancel")}
            disabled={closeDisabled}
            onPress={close}
          />
        </Stack.Toolbar>
      ) : null}
      {glass ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            separateBackground
            variant="prominent"
            icon="checkmark"
            accessibilityLabel={t("close")}
            disabled={confirmDisabled}
            onPress={confirm}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{
          gap: 24,
          paddingVertical: 16,
          ...readable.content,
          paddingBottom: 32,
        }}
      >
        {Platform.OS !== "ios" ? (
          <SearchField placeholder={searchPlaceholder} value={query} onChange={onQuery} />
        ) : null}
        {children}
      </ScrollView>
    </>
  );
}
