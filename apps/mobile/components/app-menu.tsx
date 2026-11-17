import {
  type MenuAction,
  type MenuComponentProps,
  type MenuComponentRef,
  MenuView as NativeMenuView,
} from "@expo/ui/community/menu";
import {
  RNHostView,
  Button as SwiftButton,
  Host as SwiftHost,
  Image as SwiftImage,
  Label as SwiftLabel,
  Menu as SwiftMenu,
  Section as SwiftSection,
  Toggle as SwiftToggle,
} from "@expo/ui/swift-ui";
import { disabled as disabledModifier } from "@expo/ui/swift-ui/modifiers";
import {
  Fragment,
  type ReactNode,
  type Ref,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors, motion, radius, space, type } from "@/theme";

export type { MenuAction, MenuComponentRef };

/**
 * A menu action that may carry an app image where SF Symbols has none (brand
 * marks, #934, #935): an asset-catalog template image in the iOS system menu
 * and the matching glyph in the Android popover.
 */
export type AppMenuAction = Omit<MenuAction, "subactions"> & {
  subactions?: AppMenuAction[];
  /** iOS asset-catalog image (a vector template), in place of an SF Symbol. */
  assetImage?: string;
  /** The same mark for the Android popover. */
  glyph?: ReactNode;
};

type AppMenuProps = Omit<MenuComponentProps, "actions"> & {
  actions: AppMenuAction[];
  ref?: Ref<MenuComponentRef>;
};

export interface MenuPopoverItem {
  id: string;
  label: string;
  icon?: string;
  /** A custom trailing image (e.g. a network glyph); the checkmark then leads, as in UIKit. */
  glyph?: ReactNode;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Heading shown above the first item of each run sharing the same value. */
  section?: string;
  /** Starts a new group, separated by a thicker gap like UIKit's inline menus. */
  groupStart?: boolean;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MENU_WIDTH = 250;
const EDGE = space.lg;

/** Measure a trigger and hold the open state of the popover that hangs off it. */
export function useMenuPopover() {
  const trigger = useRef<View>(null);
  const [visible, setVisible] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const open = useCallback(() => {
    setVisible(true);
    trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
  }, []);
  const close = useCallback(() => {
    setVisible(false);
    setAnchor(null);
  }, []);
  return { trigger, visible, anchor, open, close };
}

/**
 * The iOS context menu drawn for Android (H55, H59): a rounded `elevatedSurface`
 * card anchored under its trigger, hairline-separated rows, trailing checkmark,
 * red destructive rows, dimmed-nothing scrim like UIKit. Replaces Material's
 * DropdownMenu and the old AndroidFilterMenu card. Used by `MenuView` below and
 * by `AndroidFilterMenu`.
 */
export function MenuPopover({
  visible,
  anchor,
  items,
  onSelect,
  onClose,
  align = "right",
}: {
  visible: boolean;
  /** Null until the trigger is measured: the menu hangs from the top-right corner. */
  anchor: Anchor | null;
  items: MenuPopoverItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  align?: "left" | "right";
}) {
  const { t } = useLocale();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const topInset = useAndroidTopInset();
  if (!visible) return null;
  const at = anchor ?? { x: windowWidth, y: topInset, width: 0, height: 44 };
  const leadingCheck = items.some((item) => item.glyph);

  const left = Math.max(
    EDGE,
    Math.min(
      windowWidth - MENU_WIDTH - EDGE,
      align === "left" ? at.x : at.x + at.width - MENU_WIDTH,
    ),
  );
  const below = at.y + at.height + space.sm;
  const room = windowHeight - below - EDGE;
  // Flip above the trigger when the lower half cannot hold a useful menu.
  const above = room < 200 && at.y > room;
  const maxHeight = above ? at.y - space.sm - EDGE : room;

  return (
    <Modal transparent statusBarTranslucent visible animationType="none" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
      />
      <Animated.View
        entering={FadeIn.duration(motion.duration.fast)}
        exiting={FadeOut.duration(motion.duration.fast)}
        style={{
          backgroundColor: colors.elevatedSurface,
          borderCurve: "continuous",
          borderRadius: radius.container,
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.22)",
          left,
          maxHeight,
          overflow: "hidden",
          position: "absolute",
          width: MENU_WIDTH,
          ...(above ? { bottom: windowHeight - at.y + space.sm } : { top: below }),
        }}
      >
        <ScrollView bounces={false} overScrollMode="never">
          {items.map((item, index) => (
            <Fragment key={item.id}>
              {item.section && item.section !== items[index - 1]?.section ? (
                <Text
                  accessibilityRole="header"
                  style={{
                    ...type.footnote,
                    color: colors.secondaryLabel,
                    fontWeight: "600",
                    paddingHorizontal: space.lg,
                    paddingBottom: space.xxs,
                    paddingTop: space.md,
                  }}
                >
                  {item.section}
                </Text>
              ) : index > 0 ? (
                <View
                  style={{
                    backgroundColor: colors.separator,
                    height: item.groupStart ? space.sm : 0.5,
                    marginLeft: item.groupStart ? 0 : space.lg,
                  }}
                />
              ) : null}
              <PressableFeedback
                accessibilityRole="menuitem"
                accessibilityState={{ selected: !!item.selected, disabled: !!item.disabled }}
                disabled={item.disabled}
                feedback="row"
                onPress={() => onSelect(item.id)}
                style={{
                  alignItems: "center",
                  flexDirection: "row",
                  gap: space.md,
                  minHeight: 44,
                  paddingHorizontal: space.lg,
                }}
              >
                {leadingCheck ? (
                  <View style={{ alignItems: "center", width: 15 }}>
                    {item.selected ? (
                      <SymbolView
                        accessible={false}
                        name="checkmark"
                        size={15}
                        tintColor={colors.label}
                        weight="semibold"
                      />
                    ) : null}
                  </View>
                ) : null}
                <Text
                  numberOfLines={2}
                  style={{
                    ...type.body,
                    color: item.destructive ? colors.destructive : colors.label,
                    flex: 1,
                  }}
                >
                  {item.label}
                </Text>
                {item.glyph ? (
                  item.glyph
                ) : item.selected && !leadingCheck ? (
                  <SymbolView
                    accessible={false}
                    name="checkmark"
                    size={15}
                    tintColor={colors.label}
                    weight="semibold"
                  />
                ) : item.icon ? (
                  <SymbolView
                    accessible={false}
                    name={item.icon as never}
                    size={17}
                    tintColor={item.destructive ? colors.destructive : colors.label}
                  />
                ) : null}
              </PressableFeedback>
            </Fragment>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

/** Flattens `subactions` into one list; inline submenus become separated groups. */
function toItems(actions: AppMenuAction[]): MenuPopoverItem[] {
  const out: MenuPopoverItem[] = [];
  for (const action of actions) {
    if (action.attributes?.hidden) continue;
    if (action.subactions?.length) {
      const children = toItems(action.subactions);
      if (children[0]) children[0].groupStart = out.length > 0;
      out.push(...children);
      continue;
    }
    out.push({
      id: action.id ?? action.title,
      label: action.title,
      icon: typeof action.image === "string" ? action.image : undefined,
      glyph: action.glyph,
      selected: action.state === "on",
      destructive: action.attributes?.destructive,
      disabled: action.attributes?.disabled,
    });
  }
  return out;
}

function AndroidMenu({
  actions,
  onPressAction,
  onOpenMenu,
  onCloseMenu,
  shouldOpenOnLongPress = false,
  style,
  testID,
  children,
  ref,
}: AppMenuProps) {
  const { trigger, visible, anchor, open, close } = useMenuPopover();
  const show = useCallback(() => {
    void haptic("selection");
    onOpenMenu?.();
    open();
  }, [onOpenMenu, open]);
  const hide = useCallback(() => {
    close();
    onCloseMenu?.();
  }, [close, onCloseMenu]);
  useImperativeHandle(ref, () => ({ show }), [show]);

  return (
    <>
      <Pressable
        ref={trigger}
        onLongPress={shouldOpenOnLongPress ? show : undefined}
        onPress={shouldOpenOnLongPress ? undefined : show}
        style={style}
        testID={testID}
      >
        {children as ReactNode}
      </Pressable>
      <MenuPopover
        anchor={anchor}
        visible={visible}
        items={toItems(actions)}
        onClose={hide}
        onSelect={(id) => {
          hide();
          onPressAction?.({ nativeEvent: { event: id } });
        }}
      />
    </>
  );
}

/**
 * The app's one context menu (H55, H59): UIKit's native menu through
 * `@expo/ui` on iOS, the matching popover (`MenuPopover`) on Android. Same
 * props as `@expo/ui/community/menu`, so call sites only change the import.
 */
export function MenuView(props: AppMenuProps) {
  if (Platform.OS === "android") return <AndroidMenu {...props} />;
  if (hasAssetImage(props.actions)) return <AssetImageMenu {...props} />;
  return <NativeMenuView {...props} actions={props.actions as MenuAction[]} />;
}

function hasAssetImage(actions: AppMenuAction[]): boolean {
  return actions.some(
    (action) => action.assetImage !== undefined || hasAssetImage(action.subactions ?? []),
  );
}

/**
 * The iOS system menu built from `@expo/ui`'s SwiftUI views, like its
 * community `MenuView`, but with app images: that wrapper passes only SF
 * Symbol names, while SwiftUI menu items take any `Label` icon.
 */
function AssetImageMenu({ actions, onPressAction, style, testID, children }: AppMenuProps) {
  const render = (action: AppMenuAction): ReactNode => {
    if (action.attributes?.hidden) return null;
    const key = action.id ?? action.title;
    if (action.subactions?.length) {
      const items = action.subactions.map(render);
      return action.displayInline ? (
        <SwiftSection key={key} title={action.title || undefined}>
          {items}
        </SwiftSection>
      ) : (
        <SwiftMenu key={key} label={action.title}>
          {items}
        </SwiftMenu>
      );
    }
    const fire = () => onPressAction?.({ nativeEvent: { event: key } });
    const modifiers = action.attributes?.disabled ? [disabledModifier(true)] : undefined;
    const systemImage = typeof action.image === "string" ? action.image : undefined;
    const label = action.assetImage ? (
      <SwiftLabel title={action.title} icon={<SwiftImage assetName={action.assetImage} />} />
    ) : undefined;
    if (action.state === "on" || action.state === "off") {
      return (
        <SwiftToggle
          key={key}
          label={label ? undefined : action.title}
          systemImage={label ? undefined : systemImage}
          isOn={action.state === "on"}
          onIsOnChange={fire}
          modifiers={modifiers}
        >
          {label}
        </SwiftToggle>
      );
    }
    return (
      <SwiftButton
        key={key}
        label={label ? undefined : action.title}
        systemImage={label ? undefined : systemImage}
        role={action.attributes?.destructive ? "destructive" : undefined}
        modifiers={modifiers}
        onPress={fire}
      >
        {label}
      </SwiftButton>
    );
  };
  return (
    <SwiftHost matchContents style={style} testID={testID} ignoreSafeArea="all">
      <SwiftMenu
        label={
          <RNHostView matchContents>
            <>{children}</>
          </RNHostView>
        }
      >
        {actions.map(render)}
      </SwiftMenu>
    </SwiftHost>
  );
}
