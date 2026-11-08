import { useRouter } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import Stack from "expo-router/stack";
import { type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EntryBackToolbar } from "@/components/header-back-button";
import { CircleButton, NavRow } from "@/components/project-ui";
import { SearchField } from "@/components/searchable-picker";
import { useBarTitleOptions } from "@/lib/bar-title";
import type { HelpTopic } from "@/lib/help-desk";
import { seedTopicSelection, useTopicSelection } from "@/lib/help-topic-selection";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { colors, space, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

export interface HelpPageAction {
  icon: "plus" | "checkmark";
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/**
 * Where a help desk list gets its search: iOS uses the native header search
 * (as Schedule, R025); Android has no integrated-button search, so a single
 * inset field leads the list there. Never both.
 */
export function helpSearchSurface(os: string = Platform.OS): "native" | "inline" {
  return os === "ios" ? "native" : "inline";
}

/**
 * The scrolling page every help desk screen shares: native large title, back
 * item (hidden on a tab root), pull to refresh, an optional trailing toolbar
 * action (a glass circle on iOS 26) and an optional native search bar.
 */
export function HelpPage({
  title,
  children,
  refresh,
  form = false,
  showBack = true,
  action,
  onClose,
  search,
  inlineTitle = false,
}: {
  title: string;
  /** A detail page: the title sits on the bar row instead of the large title. */
  inlineTitle?: boolean;
  children: ReactNode;
  refresh?: () => Promise<void> | void;
  form?: boolean;
  showBack?: boolean;
  action?: HelpPageAction;
  /** A modal form: Close (xmark) leads the bar instead of the back item. */
  onClose?: () => void;
  search?: { placeholder: string; onChange: (text: string) => void };
}) {
  const layout = useParticipantLayout(form ? "form" : "list");
  const bottom = useRouterTabBarScrollBottomInset();
  const { t } = useLocale();
  const barTitle = useBarTitleOptions(title);
  const glass = isRealLiquidGlassAvailable();
  // A sheet's transparent bar does not inset its scroll view: start below the bar, scroll under it.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const sheetTop = onClose ? headerHeight : 0;
  // Only a user pull spins the control; background revalidation stays silent.
  const [pulling, setPulling] = useState(false);
  return (
    <>
      <Stack.Screen
        options={{
          // One header for every help desk page and sheet, as People (transparent, no
          // headerStyle) and Account (soft scroll edge): content scrolls under the bar.
          ...(onClose || inlineTitle ? { title, headerLargeTitle: false } : barTitle),
          headerBackVisible: showBack && !onClose,
          headerTransparent: true,
          headerShadowVisible: false,
          headerLargeTitleShadowVisible: false,
          scrollEdgeEffects: { top: "soft" },
          headerShown: true,
          // R025: same native integrated search as Schedule; the control owns expansion and focus.
          ...(search && helpSearchSurface() === "native"
            ? {
                headerSearchBarOptions: {
                  placeholder: search.placeholder,
                  autoCapitalize: "none" as const,
                  hideWhenScrolling: true,
                  allowToolbarIntegration: false,
                  placement: "integratedButton" as const,
                  onChangeText: (event: { nativeEvent: { text: string } }) =>
                    search.onChange(event.nativeEvent.text),
                },
              }
            : {}),
          ...(onClose && !glass
            ? {
                headerLeft: () => (
                  <CircleButton icon="xmark" label={t("cancel")} onPress={onClose} />
                ),
              }
            : {}),
          ...(action && !glass
            ? {
                headerRight: () => (
                  <CircleButton
                    icon={action.icon}
                    label={action.label}
                    prominent={action.icon === "checkmark"}
                    disabled={action.disabled}
                    onPress={action.onPress}
                  />
                ),
              }
            : {}),
        }}
      />
      {showBack && !onClose ? <EntryBackToolbar fallback="/(tabs)/help-desk" /> : null}
      {onClose && glass ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("cancel")} onPress={onClose} />
        </Stack.Toolbar>
      ) : null}
      {action && glass ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={action.icon}
            accessibilityLabel={action.label}
            disabled={action.disabled}
            variant={action.icon === "checkmark" ? "prominent" : undefined}
            onPress={action.onPress}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior={onClose ? "never" : "automatic"}
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          refresh ? (
            <AppRefreshControl
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void Promise.resolve(refresh()).finally(() => setPulling(false));
              }}
            />
          ) : undefined
        }
        contentContainerStyle={{
          ...layout.content,
          paddingTop: sheetTop + space.lg,
          paddingBottom: bottom + space.xxxl,
          gap: space.xxl,
        }}
      >
        {search && helpSearchSurface() === "inline" ? (
          <SearchField placeholder={search.placeholder} onChange={search.onChange} />
        ) : null}
        {children}
      </ScrollView>
    </>
  );
}

/** Text outside a grouped section: access notes and saved state. */
export function HelpText({
  children,
  secondary = false,
}: {
  children: ReactNode;
  secondary?: boolean;
}) {
  return (
    <Text
      selectable
      style={{
        ...type.subhead,
        color: secondary ? colors.secondaryLabel : colors.label,
        paddingHorizontal: space.lg,
      }}
    >
      {children}
    </Text>
  );
}

/** A borderless native field in a grouped row; the label is the placeholder, as in New project. */
export function HelpInput({
  label,
  value,
  onChange,
  maxLength,
  multiline = false,
  disabled = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View
      style={{
        justifyContent: multiline ? "flex-start" : "center",
        minHeight: multiline ? 120 : 56,
        paddingHorizontal: space.lg,
        paddingVertical: multiline ? space.md : 0,
      }}
    >
      <TextInput
        accessibilityLabel={label}
        autoFocus={autoFocus}
        editable={!disabled}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChange}
        placeholder={label}
        placeholderTextColor={colors.tertiaryLabel}
        style={{
          ...type.body,
          color: colors.label,
          minHeight: 44,
          padding: 0,
          textAlignVertical: multiline ? "top" : "center",
        }}
        value={value}
      />
    </View>
  );
}

/**
 * One row for a catalogue selection (like the challenge field): the chosen
 * names on the row, a chevron, and the searchable sheet on tap. The sheet
 * writes back through the shared draft, which this row mirrors into the form.
 */
export function TopicField({
  selected,
  onChange,
  maximum,
  disabled = false,
}: {
  selected: HelpTopic[];
  onChange: (topics: HelpTopic[]) => void;
  maximum: number;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const draft = useTopicSelection();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) onChange(draft.selected);
  }, [draft.selected, onChange]);
  return (
    <NavRow
      title={t("helpTopics")}
      value={selected.length ? selected.map((topic) => topic.name).join(", ") : t("add")}
      disabled={disabled}
      onPress={() => {
        opened.current = true;
        seedTopicSelection(selected, maximum);
        router.push("/help-topics");
      }}
    />
  );
}
