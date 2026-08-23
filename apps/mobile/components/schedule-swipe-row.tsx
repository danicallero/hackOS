import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

/** Admin-only swipe-to-reveal edit/delete on a Horario row (H59 3c). */
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
      renderRightActions={(progress) => (
        <RevealActions
          progress={progress}
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
  progress,
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: {
  progress: SharedValue<number>;
  editLabel?: string;
  deleteLabel: string;
  onEdit?: () => void;
  onDelete: () => void;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: interpolate(progress.value, [0, 1], [0.9, 1]) }],
    opacity: interpolate(progress.value, [0, 0.1, 1], [0, 0.5, 1]),
  }));
  return (
    <Animated.View
      style={[
        { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 12 },
        animatedStyle,
      ]}
    >
      {onEdit && editLabel ? (
        <Pressable
          accessibilityLabel={editLabel}
          accessibilityRole="button"
          onPress={onEdit}
          style={({ pressed }) => ({
            alignItems: "center",
            alignSelf: "stretch",
            backgroundColor: colors.accent,
            borderCurve: "continuous",
            borderRadius: 14,
            gap: 6,
            justifyContent: "center",
            opacity: pressed ? 0.75 : 1,
            paddingHorizontal: 18,
          })}
        >
          <SymbolView name="pencil" tintColor="white" size={16} accessible={false} />
          <Text style={{ color: "white", fontSize: 13, fontWeight: "700" }}>{editLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityLabel={deleteLabel}
        accessibilityRole="button"
        onPress={onDelete}
        style={({ pressed }) => ({
          alignItems: "center",
          alignSelf: "stretch",
          backgroundColor: colors.destructive,
          borderCurve: "continuous",
          borderRadius: 14,
          gap: 6,
          justifyContent: "center",
          marginRight: 16,
          opacity: pressed ? 0.75 : 1,
          paddingHorizontal: 18,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={16} accessible={false} />
        <Text style={{ color: "white", fontSize: 13, fontWeight: "700" }}>{deleteLabel}</Text>
      </Pressable>
    </Animated.View>
  );
}
