import type { SFSymbol } from "expo-symbols";
import type { ColorValue } from "react-native";
import { colors } from "@/theme/colors";

/**
 * Native bar-item descriptors for the header of a pane's own navigation stack (H22-H26, H55). On
 * iOS 26 each maps to a real UIBarButtonItem, so it gets the system's hover, pressed state and
 * glass; a custom RN view in the bar gets none of those. Single-pane routes use the same
 * presentation helpers, so the status symbol and the filter rows cannot diverge between layouts.
 * The Activities pane uses these builders too.
 */
type SymbolName = SFSymbol;
interface Icon {
  type: "sfSymbol";
  name: SymbolName;
}

export interface PaneBarButton {
  type: "button";
  label: string;
  accessibilityLabel: string;
  /** Omitted when the label is shown: a bar item draws its title or its symbol, not both. */
  icon?: Icon;
  tintColor?: ColorValue;
  onPress: () => void;
}

export interface PaneBarMenuAction {
  type: "action";
  label: string;
  icon?: Icon;
  state: "on" | "off";
  keepsMenuPresented: true;
  onPress: () => void;
}

export interface PaneBarMenu {
  type: "menu";
  label: string;
  accessibilityLabel: string;
  icon: Icon;
  tintColor?: ColorValue;
  menu: { items: PaneBarMenuAction[] };
}

export interface PaneBarSpacing {
  type: "spacing";
  spacing: number;
}

export type PaneBarItem = PaneBarButton | PaneBarMenu | PaneBarSpacing;

/** Space between neighbouring trailing actions, so each stays its own glass circle. */
export const PANE_BAR_ITEM_GAP = 8;

export const QUEUE_STATUS_SYMBOL = {
  attention: "exclamationmark.triangle.fill",
  ready: "arrow.triangle.2.circlepath",
} as const;

/** The sync-status symbol and tint: the warning triangle when a scan needs attention. */
export function queueStatusPresentation(hasAttention: boolean): {
  icon: (typeof QUEUE_STATUS_SYMBOL)[keyof typeof QUEUE_STATUS_SYMBOL];
  tint: ColorValue | undefined;
} {
  return hasAttention
    ? { icon: QUEUE_STATUS_SYMBOL.attention, tint: colors.destructive }
    : { icon: QUEUE_STATUS_SYMBOL.ready, tint: undefined };
}

/** A pane at least this wide shows the status with its label; narrower ones show the symbol only. */
export const STATUS_LABEL_MIN_PANE_WIDTH = 420;

/** Whether the status bar item shows its label (a glass capsule) or just its symbol (a circle). */
export function statusShowsLabel(paneWidth: number, accessibilityText: boolean): boolean {
  return !accessibilityText && paneWidth >= STATUS_LABEL_MIN_PANE_WIDTH;
}

/** The Ready / needs-attention control; pressing it opens the queue sheet. */
export function queueStatusBarItem({
  hasAttention,
  label,
  onPress,
  showLabel = false,
}: {
  hasAttention: boolean;
  label: string;
  onPress: () => void;
  showLabel?: boolean;
}): PaneBarButton {
  const { icon, tint } = queueStatusPresentation(hasAttention);
  return {
    type: "button",
    label,
    accessibilityLabel: label,
    ...(showLabel ? {} : { icon: { type: "sfSymbol" as const, name: icon } }),
    ...(tint ? { tintColor: tint } : {}),
    onPress,
  };
}

export interface FilterRow {
  id: string;
  label: string;
  icon?: SymbolName;
  selected: boolean;
}

/** The role-filter menu: one action per row with its selection, kept open between choices. */
export function filterMenuBarItem({
  accessibilityLabel,
  active,
  onSelect,
  rows,
}: {
  accessibilityLabel: string;
  active: boolean;
  onSelect: (id: string) => void;
  rows: FilterRow[];
}): PaneBarMenu {
  return {
    type: "menu",
    label: accessibilityLabel,
    accessibilityLabel,
    icon: { type: "sfSymbol", name: "line.3.horizontal.decrease" },
    ...(active ? { tintColor: colors.accent } : {}),
    menu: {
      items: rows.map((row) => ({
        type: "action" as const,
        label: row.label,
        ...(row.icon ? { icon: { type: "sfSymbol" as const, name: row.icon } } : {}),
        state: row.selected ? ("on" as const) : ("off" as const),
        keepsMenuPresented: true as const,
        onPress: () => onSelect(row.id),
      })),
    },
  };
}

/** Puts a gap between neighbouring actions so iOS 26 draws a separate glass circle for each. */
export function withBarGaps(items: Array<PaneBarButton | PaneBarMenu>): PaneBarItem[] {
  return items.flatMap((item, index) => [
    ...(index > 0 ? [{ type: "spacing" as const, spacing: PANE_BAR_ITEM_GAP }] : []),
    item,
  ]);
}
