import type { ActivityKindSymbolName } from "@hackos/shared/activity-kinds";
import {
  SymbolView as ExpoSymbolView,
  type SymbolViewProps as ExpoSymbolViewProps,
} from "expo-symbols";
import { Platform } from "react-native";

export type SymbolViewProps = ExpoSymbolViewProps;

/**
 * `expo-symbols` only resolves a bare SF Symbol string on iOS/macOS. On
 * Android (and web) `name` must be `{ android: <material-symbol-name> }` or
 * the symbol silently renders nothing — every icon in the app would be
 * blank on Android otherwise. This maps every SF Symbol name this app
 * passes as a plain string to its closest Google Material Symbols name.
 *
 * The `satisfies` intersection makes the schedule-kind symbols mandatory: add
 * a category to @hackos/shared/activity-kinds with a new SF Symbol and this
 * file fails to compile until the Android alias exists.
 */
const ANDROID_SYMBOL_NAMES = {
  "arrow.clockwise": "refresh",
  "arrow.down": "arrow_downward",
  "arrow.down.circle": "arrow_circle_down",
  "arrow.left.to.line": "first_page",
  "arrow.right.to.line": "last_page",
  "arrow.trianglehead.2.clockwise.rotate.90": "sync",
  "arrow.triangle.2.circlepath": "sync",
  bell: "notifications_none",
  "bell.badge": "notifications_active",
  "bell.badge.fill": "notifications_active",
  "bell.fill": "notifications",
  briefcase: "work",
  calendar: "calendar_month",
  "calendar.badge.clock": "event_upcoming",
  "calendar.badge.exclamationmark": "event_busy",
  "camera.fill": "camera_alt",
  "character.book.closed": "translate",
  checkmark: "check",
  "checkmark.circle.fill": "check_circle",
  "checkmark.seal": "verified",
  "checkmark.seal.fill": "verified",
  "chevron.down": "expand_more",
  "chevron.left": "chevron_left",
  "chevron.left.slash.chevron.right": "code",
  "chevron.right": "chevron_right",
  "chevron.up": "expand_less",
  "chevron.up.chevron.down": "unfold_more",
  clock: "schedule",
  "clock.arrow.circlepath": "history",
  "clock.badge.exclamationmark": "alarm",
  "clock.badge.exclamationmark.fill": "alarm",
  "clock.badge.questionmark": "more_time",
  "clock.fill": "schedule",
  doc: "description",
  "door.left.hand.closed": "door_front",
  "door.left.hand.open": "meeting_room",
  envelope: "mail",
  "envelope.badge": "mark_email_unread",
  "envelope.badge.fill": "mark_email_unread",
  eye: "visibility",
  "eye.slash": "visibility_off",
  "exclamationmark.arrow.circlepath": "sync_problem",
  "exclamationmark.circle.fill": "error",
  "exclamationmark.triangle": "warning",
  "exclamationmark.triangle.fill": "warning",
  "figure.run": "directions_run",
  flag: "flag",
  "flashlight.off.fill": "flashlight_off",
  "flashlight.on.fill": "flashlight_on",
  "fork.knife": "restaurant",
  globe: "public",
  hourglass: "hourglass_empty",
  "internaldrive.fill": "save",
  "key.card": "key",
  "key.card.fill": "key",
  "key.fill": "vpn_key",
  keyboard: "keyboard",
  "line.3.horizontal.decrease": "filter_list",
  "line.3.horizontal.decrease.circle.fill": "filter_alt",
  lanyardcard: "badge",
  "list.bullet": "list",
  "list.bullet.rectangle": "list_alt",
  "lock.fill": "lock",
  magnifyingglass: "search",
  "lock.rotation": "sync_lock",
  "mappin.and.ellipse": "location_on",
  "megaphone.fill": "campaign",
  mic: "mic",
  "note.text": "description",
  "number.circle": "pin",
  "party.popper": "celebration",
  pencil: "edit",
  person: "person",
  "person.2": "group",
  "person.2.fill": "groups",
  "person.badge.key.fill": "badge",
  "person.crop.badge.magnifyingglass": "person_search",
  "person.crop.circle.badge.checkmark": "how_to_reg",
  "person.fill": "person",
  "person.line.dotted.person.fill": "supervisor_account",
  "person.text.rectangle": "contact_page",
  phone: "phone",
  "play.rectangle": "play_circle",
  plus: "add",
  "plus.circle": "add_circle_outline",
  "plus.circle.fill": "add_circle",
  qrcode: "qr_code",
  "questionmark.circle": "help_outline",
  "qrcode.viewfinder": "qr_code_scanner",
  "rectangle.portrait.and.arrow.right": "logout",
  sparkles: "auto_awesome",
  "ticket.fill": "confirmation_number",
  trash: "delete",
  "trash.fill": "delete",
  tray: "inbox",
  trophy: "emoji_events",
  tshirt: "checkroom",
  "wrench.and.screwdriver.fill": "build",
  xmark: "close",
  "xmark.circle.fill": "cancel",
  "building.2": "business",
} as const satisfies Record<string, string> & Record<ActivityKindSymbolName, string>;

/** Return the Material Symbol alias used by Android/web, when one exists. */
export function androidSymbolName(name: string): string | undefined {
  return (ANDROID_SYMBOL_NAMES as Record<string, string | undefined>)[name];
}

/**
 * Drop-in replacement for `expo-symbols`' `SymbolView` that also renders on
 * Android. Callers keep passing a plain SF Symbol string (`icon="chevron.left"`)
 * — this resolves the Android-side Material Symbol automatically instead of
 * requiring every call site to spell out `{ ios, android }`.
 */
export function SymbolView(props: ExpoSymbolViewProps) {
  if (Platform.OS === "ios" || Platform.OS === "macos" || typeof props.name !== "string") {
    return <ExpoSymbolView {...props} />;
  }
  const android = androidSymbolName(props.name);
  if (!android) {
    return <ExpoSymbolView {...props} />;
  }
  return (
    <ExpoSymbolView
      {...props}
      name={{ android, ios: props.name, web: android } as ExpoSymbolViewProps["name"]}
    />
  );
}
