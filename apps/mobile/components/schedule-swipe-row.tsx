import type { ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { NativeGesture } from "react-native-gesture-handler";
import Swipeable, { type SwipeableProps } from "react-native-gesture-handler/ReanimatedSwipeable";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

// RNGH's default horizontal activation threshold (10px, see
// `dragOffsetFromRight`) is easy to false-trigger from the slight horizontal
// drift of an otherwise-vertical scroll gesture on Android, which opens or
// snaps shut the row mid-scroll and takes the edit/delete buttons along with
// it. iOS doesn't exhibit this — its native scroll view already disambiguates
// mostly-vertical touches before RNGH sees them — so only widen the
// threshold on Android. `Swipeable` has no vertical counterpart to this prop
// (no `failOffsetY`), so a hard/fast scroll can still occasionally cross this
// distance before RNGH's own touch-slop resolves the gesture as vertical;
// this only reduces how often that happens, it can't rule it out (#626).
const ANDROID_DRAG_OFFSET_FROM_RIGHT = -48;

// Width of `ScheduleCard`'s non-interactive time column plus the gap before
// the card itself — the only content `ScheduleSwipeRow` currently wraps. On
// Android, `hitSlop` excludes that strip from the swipe pan's touch-starting
// area entirely so a vertical scroll begun there is never even offered to
// this row's gesture; instead of merely losing the horizontal-vs-vertical
// tie-break there (as `dragOffsetFromRight` handles for the rest of the
// row), it's not a candidate at all, and the row still slides in full once a
// swipe starts over the card (`hitSlop` only gates where the gesture may
// *begin*, not what it later drags).
const ANDROID_TIME_COLUMN_HIT_EXCLUSION = 78;

/**
 * Admin-only swipe-to-reveal edit/delete on a Horario row (H59 3c). Matches
 * the accreditation-badge row's swipe pattern (`person-operations-screen.tsx`):
 * the row slides as one opaque layer to uncover these buttons, which fill the
 * row's full height and are at full opacity from the first pixel of drag —
 * never a separate pill floating mid-row.
 */
export function ScheduleSwipeRow({
  enabled,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
  scrollGesture,
  children,
}: {
  enabled: boolean;
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
  /** The vertical SectionList gesture may run alongside the row's horizontal pan. */
  scrollGesture?: NativeGesture;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Swipeable
      enabled
      containerStyle={{ width: "100%" }}
      rightThreshold={40}
      overshootRight={false}
      dragOffsetFromRight={Platform.OS === "android" ? ANDROID_DRAG_OFFSET_FROM_RIGHT : undefined}
      hitSlop={Platform.OS === "android" ? { left: -ANDROID_TIME_COLUMN_HIT_EXCLUSION } : undefined}
      simultaneousWith={scrollGesture as SwipeableProps["simultaneousWith"]}
      renderRightActions={() => (
        <RevealActions
          editLabel={editLabel}
          deleteLabel={deleteLabel}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    >
      {children}
    </Swipeable>
  );
}

function RevealActions({
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: {
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", height: "100%" }}>
      {onEdit && editLabel ? (
        <Pressable
          accessibilityLabel={editLabel}
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => ({
            alignItems: "center",
            backgroundColor: colors.accent,
            gap: 4,
            height: "100%",
            justifyContent: "center",
            opacity: pressed ? 0.75 : 1,
            paddingHorizontal: 16,
          })}
        >
          <SymbolView name="pencil" tintColor="white" size={16} accessible={false} />
          <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{editLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={deleteLabel}
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.destructive,
          gap: 4,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 16,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700" }}>{deleteLabel}</Text>
      </Pressable>
    </View>
  );
}
