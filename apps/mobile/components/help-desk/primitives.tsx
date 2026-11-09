import { useNavigation, useRouter } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import Stack from "expo-router/stack";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";
import { type MenuAction, MenuView } from "@/components/app-menu";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { FilterMenu } from "@/components/filter-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { EntryBackToolbar } from "@/components/header-back-button";
import { CircleButton, NavRow } from "@/components/project-ui";
import { SearchField } from "@/components/searchable-picker";
import { useBarTitleOptions } from "@/lib/bar-title";
import { seedChallengeSelection, useChallengeSelection } from "@/lib/help-challenge-selection";
import type { HelpChallenge, HelpTopic } from "@/lib/help-desk";
import { seedTopicSelection, useTopicSelection } from "@/lib/help-topic-selection";
import { useLocale } from "@/lib/i18n";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { fixedScrollHeaderOptions, screenTitleElement } from "@/lib/screen-header-options";
import { colors, space, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

type MenuIcon = ComponentProps<typeof Stack.Toolbar.MenuAction>["icon"] & string;

/** A gear menu beside the page action: each entry opens a destination or runs a command. */
export interface HelpPageMenu {
  label: string;
  items: { id: string; title: string; icon: MenuIcon; selected?: boolean; onPress: () => void }[];
}

export interface HelpPageAction {
  icon: "plus" | "checkmark" | "hand.raised";
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
  menu,
  filter,
  filterMenu,
  onClose,
  search,
  inlineTitle = false,
  fixedTitle = false,
}: {
  title: string;
  /** A detail page: the title sits on the bar row instead of the large title. */
  inlineTitle?: boolean;
  /** H55: the tab title stays on one bar row, using Scanner's shared typography. */
  fixedTitle?: boolean;
  children: ReactNode;
  refresh?: () => Promise<void> | void;
  form?: boolean;
  showBack?: boolean;
  action?: HelpPageAction;
  /** A gear menu left of the action (a visible `gearshape`, never an overflow of icons). */
  menu?: HelpPageMenu;
  /** A persistent filter menu (Schedule's `FilterMenu`) beside the search. */
  filter?: ReactNode;
  filterMenu?: HelpPageMenu;
  /** A modal form: Close (xmark) leads the bar instead of the back item. */
  onClose?: () => void;
  search?: { placeholder: string; onChange: (text: string) => void };
}) {
  const layout = useParticipantLayout(form ? "form" : "list");
  const bottom = useRouterTabBarScrollBottomInset();
  const { t } = useLocale();
  const barTitle = useBarTitleOptions(title);
  const glass = isRealLiquidGlassAvailable();
  const navigation = useNavigation();
  const searchPlaceholder = search?.placeholder;
  const onSearchChange = search?.onChange;
  // Glass: one setOptions carries the fixed header AND the native search, like Schedule
  // (a separate <Stack.Screen> would replace the fixed options with a large title, R032).
  useLayoutEffect(() => {
    if (!fixedTitle || !glass) return;
    navigation.setOptions({
      ...fixedScrollHeaderOptions(title, glass),
      // A tab root has nothing to go back to; a pushed page keeps the native back item.
      headerBackVisible: showBack && !onClose,
      ...(searchPlaceholder !== undefined && onSearchChange && helpSearchSurface() === "native"
        ? {
            headerSearchBarOptions: {
              placeholder: searchPlaceholder,
              autoCapitalize: "none" as const,
              hideWhenScrolling: true,
              allowToolbarIntegration: false,
              placement: "integratedButton" as const,
              onChangeText: (event: { nativeEvent: { text: string } }) =>
                onSearchChange(event.nativeEvent.text),
            },
          }
        : {}),
    });
  }, [navigation, fixedTitle, title, glass, showBack, onClose, searchPlaceholder, onSearchChange]);
  // A sheet's transparent bar does not inset its scroll view: start below the bar, scroll under it.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const sheetTop = onClose ? headerHeight : 0;
  // Only a user pull spins the control; background revalidation stays silent.
  const [pulling, setPulling] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentInsetAdjustmentBehavior={onClose ? "never" : "automatic"}
        // Only forms need the keyboard inset: on a list with native search it leaves the
        // content scrolled under the bar after the search closes (Activities omits it too).
        automaticallyAdjustKeyboardInsets={form}
        keyboardDismissMode={form ? "interactive" : "on-drag"}
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
      {!fixedTitle || !glass ? (
        <Stack.Screen
          options={{
            // One header for every help desk page and sheet, as People (transparent, no
            // headerStyle) and Account (soft scroll edge): content scrolls under the bar.
            ...(fixedTitle
              ? fixedScrollHeaderOptions(title, glass)
              : onClose || inlineTitle
                ? { title, headerLargeTitle: false }
                : barTitle),
            headerBackVisible: showBack && !onClose,
            headerTransparent: true,
            headerShadowVisible: false,
            headerLargeTitleShadowVisible: false,
            headerBlurEffect: "none",
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
            ...((action || menu || filter || filterMenu) && !glass
              ? {
                  headerRight: () => (
                    <View style={{ alignItems: "center", flexDirection: "row", gap: space.sm }}>
                      {filter}
                      {filterMenu ? (
                        <FilterMenu
                          accessibilityLabel={filterMenu.label}
                          active={filterMenu.items.some((item) => item.selected)}
                          items={filterMenu.items.map((item) => ({
                            id: item.id,
                            label: item.title,
                            selected: !!item.selected,
                          }))}
                          onSelect={(id) =>
                            filterMenu.items.find((item) => item.id === id)?.onPress()
                          }
                        />
                      ) : null}
                      {menu ? (
                        <MenuView
                          actions={menu.items.map(({ id, title, icon, selected }) => ({
                            id,
                            title,
                            image: icon as MenuAction["image"],
                            state: selected ? "on" : "off",
                          }))}
                          shouldOpenOnLongPress={false}
                          onPressAction={({ nativeEvent }) =>
                            menu.items.find((item) => item.id === nativeEvent.event)?.onPress()
                          }
                        >
                          <CircleButton icon="gearshape" label={menu.label} onPress={() => {}} />
                        </MenuView>
                      ) : null}
                      {action ? (
                        <CircleButton
                          icon={action.icon}
                          label={action.label}
                          prominent={action.icon === "checkmark"}
                          disabled={action.disabled}
                          onPress={action.onPress}
                        />
                      ) : null}
                    </View>
                  ),
                }
              : {}),
          }}
        />
      ) : null}
      {fixedTitle && glass ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.View hidesSharedBackground>
            {screenTitleElement(title, { numberOfLines: 1 })}
          </Stack.Toolbar.View>
        </Stack.Toolbar>
      ) : null}
      {showBack && !onClose ? <EntryBackToolbar fallback="/(tabs)/help-desk" /> : null}
      {onClose && glass ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="xmark" accessibilityLabel={t("cancel")} onPress={onClose} />
        </Stack.Toolbar>
      ) : null}
      {(action || menu || filter || filterMenu) && glass ? (
        <Stack.Toolbar placement="right">
          {filter ? (
            <Stack.Toolbar.View hidesSharedBackground>{filter as ReactElement}</Stack.Toolbar.View>
          ) : null}
          {filterMenu ? (
            <Stack.Toolbar.View hidesSharedBackground separateBackground>
              <FilterMenu
                accessibilityLabel={filterMenu.label}
                active={filterMenu.items.some((item) => item.selected)}
                items={filterMenu.items.map((item) => ({
                  id: item.id,
                  label: item.title,
                  selected: !!item.selected,
                }))}
                onSelect={(id) => filterMenu.items.find((item) => item.id === id)?.onPress()}
              />
            </Stack.Toolbar.View>
          ) : null}
          {filterMenu ? <Stack.Toolbar.Spacer width={8} /> : null}
          {menu ? (
            <Stack.Toolbar.Menu icon="gearshape" accessibilityLabel={menu.label}>
              {menu.items.map((item) => (
                <Stack.Toolbar.MenuAction
                  key={item.id}
                  icon={item.icon}
                  onPress={item.onPress}
                  isOn={item.selected}
                  unstable_keepPresented={item.selected !== undefined}
                >
                  {item.title}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
          ) : null}
          {action ? (
            <Stack.Toolbar.Button
              icon={action.icon}
              accessibilityLabel={action.label}
              disabled={action.disabled}
              variant={action.icon === "checkmark" ? "prominent" : undefined}
              onPress={action.onPress}
            />
          ) : null}
        </Stack.Toolbar>
      ) : null}
    </View>
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
  other,
  onOtherChange,
  allowAdd = false,
  disabled = false,
}: {
  selected: HelpTopic[];
  onChange: (topics: HelpTopic[]) => void;
  maximum: number;
  /** The request form's "Other" choice, edited inside the picker; absent for helper knowledge. */
  other?: boolean;
  onOtherChange?: (other: boolean) => void;
  /** Eligible helpers may add a name to the catalogue from the picker. */
  allowAdd?: boolean;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const draft = useTopicSelection();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) onChange(draft.selected);
  }, [draft.selected, onChange]);
  useEffect(() => {
    if (opened.current && onOtherChange) onOtherChange(draft.other);
  }, [draft.other, onOtherChange]);
  const names = [...selected.map((topic) => topic.name), ...(other ? [t("helpOther")] : [])];
  return (
    <NavRow
      title={t("helpTopics")}
      value={names.length ? names.join(", ") : t("add")}
      disabled={disabled}
      onPress={() => {
        opened.current = true;
        seedTopicSelection(selected, maximum, onOtherChange ? !!other : null, allowAdd);
        router.push("/help-topics");
      }}
    />
  );
}

/** One row for the request's challenge: its name or None, opening the single-choice sheet. */
export function ChallengeField({
  selected,
  onChange,
  disabled = false,
}: {
  selected: HelpChallenge | null;
  onChange: (challenge: HelpChallenge | null) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const draft = useChallengeSelection();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) onChange(draft.selected);
  }, [draft.selected, onChange]);
  return (
    <NavRow
      title={t("helpChallenge")}
      value={selected?.name ?? t("helpNoChallenge")}
      disabled={disabled}
      onPress={() => {
        opened.current = true;
        seedChallengeSelection(selected);
        router.push("/help-challenges");
      }}
    />
  );
}
