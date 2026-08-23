import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

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
  children,
}: {
  enabled: boolean;
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Swipeable
      enabled
      containerStyle={{ width: "100%" }}
      rightThreshold={40}
      overshootRight={false}
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
