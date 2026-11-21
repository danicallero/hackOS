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
  /** A native bar-item badge (iOS 26+). */
  badge?: QueueBadge;
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

/** Space between neighboring trailing actions, so each stays its own glass circle. */
export const PANE_BAR_ITEM_GAP = 8;

/** The sync button keeps one symbol; its badge carries the queue state. */
export const QUEUE_STATUS_SYMBOL = "arrow.triangle.2.circlepath";

export interface QueueBadge {
  value: string;
  style: { backgroundColor: ColorValue; color: ColorValue };
}

/**
 * The sync button's badge: `!` while a scan was rejected, else the number of
 * scans saved on this device and not yet confirmed, else none.
 */
export function queueStatusBadge(health: { attention: number; saved: number }): QueueBadge | null {
  if (health.attention > 0) {
    return { value: "!", style: { backgroundColor: colors.destructive, color: colors.onBadge } };
  }
  if (health.saved > 0) {
    return {
      value: health.saved > 99 ? "99+" : String(health.saved),
      style: { backgroundColor: colors.warning, color: colors.onBadge },
    };
  }
  return null;
}

/** A pane at least this wide shows the status with its label; narrower ones show the symbol only. */
export const STATUS_LABEL_MIN_PANE_WIDTH = 420;

/** Whether the status bar item shows its label (a glass capsule) or just its symbol (a circle). */
export function statusShowsLabel(paneWidth: number, accessibilityText: boolean): boolean {
  return !accessibilityText && paneWidth >= STATUS_LABEL_MIN_PANE_WIDTH;
}

/** The Ready / needs-attention control; pressing it opens the queue sheet. */
export function queueStatusBarItem({
  health,
  label,
  onPress,
  showLabel = false,
}: {
  health: { attention: number; saved: number };
  label: string;
  onPress: () => void;
  showLabel?: boolean;
}): PaneBarButton {
  const badge = queueStatusBadge(health);
  return {
    type: "button",
    label,
    accessibilityLabel: label,
    ...(showLabel ? {} : { icon: { type: "sfSymbol" as const, name: QUEUE_STATUS_SYMBOL } }),
    ...(badge ? { badge } : {}),
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

/** Puts a gap between neighboring actions so iOS 26 draws a separate glass circle for each. */
export function withBarGaps(items: Array<PaneBarButton | PaneBarMenu>): PaneBarItem[] {
  return items.flatMap((item, index) => [
    ...(index > 0 ? [{ type: "spacing" as const, spacing: PANE_BAR_ITEM_GAP }] : []),
    item,
  ]);
}
