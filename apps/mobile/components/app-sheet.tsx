import type { ComponentProps } from "react";
import { Modal, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, space } from "@/theme";

type SheetModalProps = Omit<ComponentProps<typeof Modal>, "presentationStyle" | "transparent">;

/** Gap between the status bar and the sheet's top edge (UIKit shows the page behind). */
const TOP_GAP = space.sm;

/**
 * The app's one page sheet (H55, H59). iOS presents UIKit's `pageSheet`;
 * Android, where `pageSheet` is a plain full-screen window, draws the same
 * thing: dimmed scrim, 22 pt continuous top corners, grabber, and a top edge
 * below the status bar. Content is the sheet's own surface, so callers no
 * longer add the status-bar inset to their headers.
 */
export function SheetModal({ children, onRequestClose, ...rest }: SheetModalProps) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "android") {
    return (
      <Modal onRequestClose={onRequestClose} presentationStyle="pageSheet" {...rest}>
        {children}
      </Modal>
    );
  }
  return (
    <Modal
      animationType="slide"
      onRequestClose={onRequestClose}
      statusBarTranslucent
      transparent
      {...rest}
    >
      <View style={{ backgroundColor: colors.scrim, flex: 1 }}>
        <Pressable
          accessible={false}
          onPress={onRequestClose}
          style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}
        />
        <View
          style={{
            backgroundColor: colors.background,
            borderCurve: "continuous",
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            bottom: 0,
            left: 0,
            overflow: "hidden",
            position: "absolute",
            right: 0,
            top: insets.top + TOP_GAP,
          }}
        >
          {children}
          <View
            pointerEvents="none"
            style={{
              alignSelf: "center",
              backgroundColor: colors.tertiaryLabel,
              borderRadius: radius.full,
              height: 5,
              position: "absolute",
              top: space.xs,
              width: 36,
            }}
          />
        </View>
      </View>
    </Modal>
  );
}
