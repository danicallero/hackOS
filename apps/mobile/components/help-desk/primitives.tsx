import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useFocusEffect, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EntryBackToolbar } from "@/components/header-back-button";
import { Section, StatusPill } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { CircleButton } from "@/components/project-ui";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { useBarTitleOptions } from "@/lib/bar-title";
import type { HelpTopic } from "@/lib/help-desk";
import { seedTopicSelection, useTopicSelection } from "@/lib/help-topic-selection";
import { useLocale } from "@/lib/i18n";
import { subscribeToNotificationChanges } from "@/lib/notification-events";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { startDomainEventStream, subscribeToServerEvent } from "@/lib/server-events";
import { colors, radius, space, type } from "@/theme";
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

export function HelpSearchField({
  placeholder,
  onChange,
}: {
  placeholder: string;
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
      style={{
        ...type.body,
        backgroundColor: colors.surface,
        borderCurve: "continuous",
        borderRadius: radius.control,
        color: colors.label,
        minHeight: 44,
        paddingHorizontal: space.lg,
      }}
    />
  );
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
}: {
  title: string;
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
  // Only a user pull spins the control; background revalidation stays silent.
  const [pulling, setPulling] = useState(false);
  return (
    <>
      <Stack.Screen
        options={{
          ...barTitle,
          headerBackVisible: showBack && !onClose,
          headerShown: true,
          headerTransparent: false,
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
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
        contentInsetAdjustmentBehavior="automatic"
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
          paddingTop: space.lg,
          paddingBottom: bottom + space.xxxl,
          gap: space.xxl,
        }}
      >
        {search && helpSearchSurface() === "inline" ? <HelpSearchField {...search} /> : null}
        {children}
      </ScrollView>
    </>
  );
}

/** Secondary text outside a card (hints, empty notes). Inside a card use `HelpNote`. */
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

/** Text that sits inside a grouped card, with the card's own row padding. */
export function HelpNote({ children }: { children: ReactNode }) {
  return (
    <Text
      selectable
      style={{
        ...type.body,
        color: colors.secondaryLabel,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
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

/** Single or multiple choice from a list: the checkmark marks the choice, as in the challenge picker. */
export function ChoiceRow({
  label,
  detail,
  selected,
  onPress,
  disabled = false,
  icon,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  icon?: SymbolViewProps["name"];
}) {
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 50,
        opacity: disabled && !selected ? 0.45 : 1,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      {icon ? (
        <SymbolView name={icon} tintColor={colors.accent} size={22} accessible={false} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ ...type.body, color: colors.label }}>{label}</Text>
        {detail ? (
          <Text style={{ ...type.compact, color: colors.secondaryLabel }}>{detail}</Text>
        ) : null}
      </View>
      {selected ? (
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

/** Topic names as quiet pills, wrapping like the profile chips. */
export function TopicChips({ topics, other = false }: { topics: HelpTopic[]; other?: boolean }) {
  const { t } = useLocale();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
      {topics.map((topic) => (
        <StatusPill key={topic.id}>{topic.name}</StatusPill>
      ))}
      {other ? <StatusPill>{t("helpOther")}</StatusPill> : null}
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
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={t("helpTopics")}
      disabled={disabled}
      onPress={() => {
        opened.current = true;
        seedTopicSelection(selected, maximum);
        router.push("/help-topics");
      }}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 56,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <Text style={{ ...type.body, color: colors.label }}>{t("helpTopics")}</Text>
      <Text
        numberOfLines={2}
        style={{
          ...type.body,
          color: selected.length ? colors.secondaryLabel : colors.tertiaryLabel,
          flex: 1,
          textAlign: "right",
        }}
      >
        {selected.length ? selected.map((topic) => topic.name).join(", ") : t("add")}
      </Text>
      <SymbolView
        name="chevron.right"
        tintColor={colors.tertiaryLabel}
        size={12}
        weight="semibold"
        accessible={false}
      />
    </PressableFeedback>
  );
}

/** An icon and a value in a grouped card (location, requester, meeting point). */
export function DetailRow({
  icon,
  children,
}: {
  icon: SymbolViewProps["name"];
  children: ReactNode;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 50,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <SymbolView name={icon} tintColor={colors.accent} size={22} accessible={false} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

export { Section };
/**
 * Only server-confirmed values are displayed. Focus, push and pull refreshes
 * revalidate in place: the last response stays on screen (no blank flash, no
 * lost scroll or draft) and an identical response does not re-render. Only a
 * different `path` starts from an empty state.
 */
export function useHelpResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const shown = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    const current = ++generation.current;
    setLoading(true);
    try {
      // A stalled request ends in the retryable error state instead of an endless spinner.
      const result = await apiFetch<T>(path, { signal: AbortSignal.timeout(20_000) });
      if (generation.current !== current) return;
      const serialized = JSON.stringify(result);
      if (serialized !== shown.current) {
        shown.current = serialized;
        setData(result);
      }
      setError(null);
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new path discards the previous resource.
  useEffect(() => {
    shown.current = null;
    setData(null);
    setError(null);
  }, [path]);
  const replace = useCallback((next: T | null | ((current: T | null) => T | null)) => {
    setData((current) => {
      const value =
        typeof next === "function" ? (next as (c: T | null) => T | null)(current) : next;
      shown.current = value === null ? null : JSON.stringify(value);
      return value;
    });
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      const stop = subscribeToNotificationChanges(() => void load());
      const stopDomain = path
        ? startDomainEventStream(SSE_TOPICS.HELPDESK, { onResync: () => void load() })
        : () => {};
      const stopChange = subscribeToServerEvent(
        EVENTS.DOMAIN_CHANGED,
        () => void load(),
        domainScope(SSE_TOPICS.HELPDESK),
      );
      const stopPersonal = subscribeToServerEvent(
        EVENTS.HELPDESK_REQUEST_CHANGED,
        () => void load(),
      );
      return () => {
        generation.current++;
        stop();
        stopDomain();
        stopChange();
        stopPersonal();
      };
    }, [load, path]),
  );
  return { data, error, loading, load, setData: replace };
}
